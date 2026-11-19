'use strict'

// Builds a small virtual network out of Linux network namespaces, so the
// tests can send real SSDP packets between several "machines".
//
//   lan   A bridge. It works like one network switch.
//   host  A network namespace. It has one interface for each lan it joins:
//         `eth0` for the first lan, `eth1` for the second, and so on.
//   peer  A Node process that runs inside a host. It owns one SSDP server,
//         one SSDP client or one probe (see `agent.js`).
//
// This needs Linux, root and the `ip` tool. `test/network/run.sh` starts a
// container that has all three.

const { execFileSync, spawn } = require('node:child_process')
const { once } = require('node:events')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')

const AGENT = path.join(__dirname, 'agent.js')

let labCount = 0

function ip (...args) {
  try {
    return execFileSync('ip', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (error) {
    throw new Error('`ip ' + args.join(' ') + '` failed: ' + (error.stderr || error.message).trim())
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

class Host {
  constructor (name, number, lans) {
    this.name = name
    this._links = new Map()
    this._peers = []

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

  /**
   * Creates an SSDP server on this host. It is not started.
   *
   * @param {Object} [opts] Options for the `Server` constructor
   * @param {String[]} [usns] Passed to `addUSN` one by one
   * @returns {Promise<Peer>}
   */
  server (opts, usns) {
    return this._peer('server', opts || {}, usns || [])
  }

  /**
   * Creates an SSDP client on this host. It is not started.
   *
   * @param {Object} [opts] Options for the `Client` constructor
   * @returns {Promise<Peer>}
   */
  client (opts) {
    return this._peer('client', opts || {}, [])
  }

  /**
   * Creates and starts a probe on this host: a plain UDP socket on the SSDP
   * port. It does not use the library.
   *
   * It records every packet it receives as a `packet` event, so a test can
   * check what is really on the lan. It can also send any packet to the
   * SSDP group with `send`.
   *
   * @returns {Promise<Peer>}
   */
  async probe () {
    const peer = await this._peer('probe')

    await peer.start()

    return peer
  }

  async closePeers () {
    const peers = this._peers

    this._peers = []

    await Promise.all(peers.map((peer) => peer.close()))
  }

  async _peer (kind, ...args) {
    // `ip netns exec` replaces itself with the command. The Node process
    // keeps the IPC channel that `spawn` opened.
    const child = spawn('ip', ['netns', 'exec', this.name, process.execPath, AGENT], {
      stdio: ['ignore', 'inherit', 'inherit', 'ipc']
    })
    const peer = new Peer(child)

    this._peers.push(peer)

    await peer._call('create', kind, ...args)

    return peer
  }
}

class Peer {
  constructor (child) {
    /**
     * Every event the peer has reported so far, oldest first.
     *
     * A server or client reports `response`, `advertise-alive` and
     * `advertise-bye`: `{name, headers, statusCode, rinfo}`.
     * A probe reports `packet`: `{name, startLine, headers, rinfo}`.
     */
    this.events = []

    this._child = child
    this._calls = new Map()
    this._lastCall = 0
    this._watchers = new Set()

    child.on('message', (message) => {
      if (message.event) {
        this.events.push(message.event)
        this._watchers.forEach((watch) => watch())
        return
      }

      const call = this._calls.get(message.id)

      this._calls.delete(message.id)

      if (message.error) {
        call.reject(new Error('Peer failed: ' + message.error))
      } else {
        call.resolve()
      }
    })

    child.on('exit', (code, signal) => {
      this._calls.forEach((call) => call.reject(new Error('Peer exited: ' + (signal || 'code ' + code))))
      this._calls.clear()
    })
  }

  start () {
    return this._call('start')
  }

  stop () {
    return this._call('stop')
  }

  /**
   * Sends one packet from a probe to the SSDP group.
   *
   * @param {String[]} lines Start line and headers
   */
  send (lines) {
    return this._call('send', lines)
  }

  /**
   * Sends an M-SEARCH from a client.
   *
   * @param {String} serviceType
   * @param {Number} [wait] How long to wait for responses (ms)
   * @returns {Promise<Object[]>} `response` events that arrived in that time
   */
  async search (serviceType, wait) {
    const seen = this.events.length

    await this._call('search', serviceType)
    await sleep(wait || 300)

    return this.events.slice(seen).filter((event) => event.name === 'response')
  }

  /**
   * Waits, then returns the events with this name that arrived meanwhile.
   *
   * @param {String} name
   * @param {Number} ms
   * @returns {Promise<Object[]>}
   */
  async during (name, ms) {
    const seen = this.events.length

    await sleep(ms)

    return this.events.slice(seen).filter((event) => event.name === name)
  }

  /**
   * Returns the first event with this name that `match` accepts. Events that
   * arrived before this call count too. Fails when none arrives in time.
   *
   * @param {String} name
   * @param {Function} [match] Takes an event, returns true to accept it
   * @param {Number} [timeout] ms
   * @returns {Promise<Object>}
   */
  waitFor (name, match, timeout) {
    timeout = timeout || 3000

    return new Promise((resolve, reject) => {
      const watch = () => {
        const found = this.events.find((event) => event.name === name && (!match || match(event)))

        if (found) {
          clearTimeout(timer)
          this._watchers.delete(watch)
          resolve(found)
        }
      }

      const timer = setTimeout(() => {
        this._watchers.delete(watch)
        reject(new Error('No matching "' + name + '" event within ' + timeout + ' ms'))
      }, timeout)

      this._watchers.add(watch)
      watch()
    })
  }

  /**
   * Ends the peer process.
   */
  async close () {
    const child = this._child

    if (child.exitCode !== null || child.signalCode !== null) return

    const exited = once(child, 'exit')
    // The agent exits by itself when the IPC channel closes.
    const timer = setTimeout(() => child.kill('SIGKILL'), 2000)

    if (child.connected) child.disconnect()

    await exited

    clearTimeout(timer)
  }

  _call (command, ...args) {
    return new Promise((resolve, reject) => {
      const id = ++this._lastCall

      this._calls.set(id, { resolve, reject })
      this._child.send({ id, command, args })
    })
  }
}

module.exports = { Lab }
