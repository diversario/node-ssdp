'use strict'

// Builds a small virtual network out of Linux network namespaces, so the
// tests can send real SSDP packets between several "machines".
//
//   lan   A bridge. It works like one network switch.
//   host  A network namespace. It has one interface for each lan it joins:
//         `eth0` for the first lan, `eth1` for the second, and so on.
//   peer  A Node process that runs inside a host. It owns one SSDP server,
//         one SSDP client, one probe, or several servers in cluster workers
//         (see `machine.js` and `agent.js`).
//
// This needs Linux, root and the `ip` tool. `test/network/run.sh` starts a
// container that has all three.

const { execFileSync, spawn } = require('node:child_process')
const { Machine } = require('./machine')

let labCount = 0

function ip (...args) {
  try {
    return execFileSync('ip', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error('`ip ' + args.join(' ') + '` failed: ' + (error.stderr || error.message).trim(), { cause: error })
  }
}

class Lab {
  constructor () {
    if (process.platform !== 'linux' || process.getuid() !== 0) {
      throw new Error('The network tests need Linux and root. Run `make test-network`: it starts a container that has both.')
    }

    this._id = ++labCount
    this._lans = []
    this._hosts = []
  }

  /**
   * Adds a lan. Hosts on the same lan see each other's multicast packets.
   */
  addLan () {
    const index = this._lans.length + 1
    const lan = {
      bridge: 'lab' + this._id + 'br' + index,
      prefix: '10.' + this._id + '.' + index
    }

    // Multicast snooping is off, so the bridge sends every multicast packet
    // to every port. A plain unmanaged switch does the same.
    ip('link', 'add', lan.bridge, 'type', 'bridge', 'mcast_snooping', '0')
    ip('link', 'set', lan.bridge, 'up')

    this._lans.push(lan)

    return lan
  }

  /**
   * Adds a host with one interface on each of the given lans.
   * The default route of the host goes through the first lan.
   */
  addHost (lans) {
    const host = new Host('lab' + this._id + 'h' + (this._hosts.length + 1), this._hosts.length + 1, lans)

    this._hosts.push(host)

    return host
  }

  /**
   * Stops every peer on every host. The hosts and lans stay.
   */
  async closePeers () {
    await Promise.all(this._hosts.map((host) => host.closePeers()))
  }

  /**
   * Stops every peer and removes every host and lan.
   */
  async destroy () {
    await this.closePeers()

    this._hosts.forEach((host) => ip('netns', 'del', host.name))
    this._lans.forEach((lan) => ip('link', 'del', lan.bridge))
  }
}

class Host extends Machine {
  constructor (name, number, lans) {
    super()

    this.name = name
    this._links = new Map()

    ip('netns', 'add', name)
    ip('-n', name, 'link', 'set', 'lo', 'up')

    lans.forEach((lan, i) => {
      const ifname = 'eth' + i
      const address = lan.prefix + '.' + number
      // The cable has two ends. One end is `ifname` inside the host.
      // The other end is plugged into the bridge.
      const plug = name + 'e' + i

      ip('link', 'add', plug, 'type', 'veth', 'peer', 'name', ifname, 'netns', name)
      ip('link', 'set', plug, 'master', lan.bridge)
      ip('link', 'set', plug, 'up')
      ip('-n', name, 'addr', 'add', address + '/24', 'dev', ifname)
      ip('-n', name, 'link', 'set', ifname, 'up')

      this._links.set(lan, { ifname, address })
    })

    // A real machine has one default route. Here it goes through `eth0`.
    // Nothing answers at the gateway address: the tests only send packets
    // inside a lan.
    ip('-n', name, 'route', 'add', 'default', 'via', lans[0].prefix + '.254', 'dev', 'eth0')
  }

  /**
   * IPv4 address of this host on the lan.
   */
  address (lan) {
    return this._links.get(lan).address
  }

  /**
   * Name of the interface that connects this host to the lan.
   */
  ifname (lan) {
    return this._links.get(lan).ifname
  }

  /**
   * Gives the interface to the lan one more IPv4 address.
   *
   * @param lan
   * @param {String} cidr For example `192.168.7.1/24`
   * @param {String} [label] Linux then lists the address under this
   *   interface name. It is the real name, a colon and a suffix: `eth0:1`.
   */
  addAddress (lan, cidr, label) {
    const args = ['-n', this.name, 'addr', 'add', cidr, 'dev', this.ifname(lan)]

    ip(...(label ? args.concat('label', label) : args))
  }

  /**
   * IPv4 multicast groups this host has joined on its interface to the lan.
   */
  groups (lan) {
    return ip('-n', this.name, 'maddr', 'show', 'dev', this.ifname(lan))
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((words) => words[0] === 'inet')
      .map((words) => words[1])
  }

  /**
   * Changes a kernel setting of this host,
   * for example `net.ipv4.igmp_max_memberships`.
   */
  sysctl (name, value) {
    ip('netns', 'exec', this.name, 'sysctl', '-q', '-w', name + '=' + value)
  }

  // `ip netns exec` replaces itself with the command. The Node process
  // keeps the IPC channel that `spawn` opened.
  _spawn (args, options) {
    return spawn('ip', ['netns', 'exec', this.name, process.execPath, ...args], options)
  }
}

module.exports = { Lab }
