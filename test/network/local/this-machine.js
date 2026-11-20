'use strict'

// Real SSDP packets between processes on the machine that runs the tests,
// through its own network interfaces. These tests need no container and no
// root, so they also run on macOS and Windows.
//
// Every server, client and probe is one process (see
// `../support/machine.js`). A multicast message that a machine sends also
// comes back to that machine, once through every interface it was sent
// through. So a client here gets one answer from a server through every
// interface.
//
// Other devices on the same network can answer too. The tests use their own
// device types and UDNs, and look only at messages that carry such a UDN.

const assert = require('node:assert/strict')
const dgram = require('node:dgram')
const os = require('node:os')
const { setTimeout: sleep } = require('node:timers/promises')
const { Machine } = require('../support/machine')

const GROUP = '239.255.255.250'
const TYPE = 'urn:node-ssdp-test:device:Local:1'
const OTHER_TYPE = 'urn:node-ssdp-test:service:Local:1'
const LOCATION = { port: 8080, path: '/desc.xml' }
const UDN_PREFIX = 'uuid:node-ssdp-local-' + process.pid + '-'

let udnCount = 0

function newUdn () {
  return UDN_PREFIX + (++udnCount)
}

// True for a message from a server of these tests.
function ours (event) {
  return String(event.headers.USN).startsWith(UDN_PREFIX)
}

function isNotify (nts) {
  return function (packet) {
    return packet.startLine === 'NOTIFY * HTTP/1.1' && packet.headers.NTS === nts && ours(packet)
  }
}

// `<USN> from <address>` for every message, sorted.
function sources (events) {
  return events.map((event) => event.headers.USN + ' from ' + event.rinfo.address).sort()
}

function externalIPv4 () {
  return Object.entries(os.networkInterfaces()).flatMap(([name, infos]) => {
    return infos.filter((info) => info.family === 'IPv4' && !info.internal).map((info) => ({ name, address: info.address }))
  })
}

/**
 * Returns the IPv4 addresses of the interfaces through which this machine
 * can send a multicast message to itself. It finds them with plain UDP
 * sockets, without the library.
 *
 * @returns {Promise<String[]>}
 */
async function multicastAddresses () {
  const candidates = externalIPv4().map((nic) => nic.address)
  const receiver = dgram.createSocket({ type: 'udp4', reuseAddr: true })
  const arrived = new Set()

  receiver.on('message', (data, rinfo) => {
    // The message names the address it was sent through.
    if (data.toString() === rinfo.address) arrived.add(rinfo.address)
  })

  await new Promise((resolve, reject) => receiver.once('error', reject).bind(0, resolve))

  for (const address of candidates) {
    const sender = dgram.createSocket('udp4')

    try {
      await new Promise((resolve, reject) => sender.once('error', reject).bind(0, resolve))

      try {
        receiver.addMembership(GROUP, address)
      } catch {
        // A second address of an interface cannot join again. The first
        // one has joined for the interface.
      }

      sender.setMulticastInterface(address)

      await new Promise((resolve) => sender.send(address, receiver.address().port, GROUP, resolve))
    } catch {
      // This interface cannot do it.
    }

    sender.close()
  }

  await sleep(300)

  receiver.close()

  return candidates.filter((address) => arrived.has(address))
}

describe('SSDP between processes on this machine', function () {
  const machine = new Machine()
  let addresses

  // `<USN> from <address>` for every USN through every interface, sorted.
  function throughEveryInterface (usns) {
    return usns.flatMap((usn) => addresses.map((address) => usn + ' from ' + address)).sort()
  }

  // A new client searches. Returns the answers of the servers of these tests.
  async function search (type, wait) {
    const client = await machine.client()

    return (await client.search(type, wait || 1000)).filter(ours)
  }

  before(async function () {
    addresses = await multicastAddresses()

    assert.notEqual(addresses.length, 0, 'This machine cannot send a multicast message to itself through any network interface.')
  })

  afterEach(function () {
    return machine.closePeers()
  })

  context('when a client searches', function () {
    it('gets one response through every interface for every USN of the server when it asks for ssdp:all', async function () {
      const udn = newUdn()
      const server = await machine.server({ udn, location: LOCATION }, [TYPE, OTHER_TYPE])
      await server.start()

      const responses = await search('ssdp:all')

      assert.deepEqual(sources(responses), throughEveryInterface([udn, udn + '::' + TYPE, udn + '::' + OTHER_TYPE]))

      responses.forEach((response) => {
        assert.equal(response.statusCode, 200)
        assert.equal(response.headers.LOCATION, 'http://' + response.rinfo.address + ':8080/desc.xml')
      })
    })

    it('gets only the matching response when it asks for one type', async function () {
      const udn = newUdn()
      const server = await machine.server({ udn }, [TYPE, OTHER_TYPE])
      await server.start()

      assert.deepEqual(sources(await search(TYPE)), throughEveryInterface([udn + '::' + TYPE]))
    })

    it('gets no response when no server has the type', async function () {
      const server = await machine.server({ udn: newUdn() }, [TYPE])
      await server.start()

      assert.deepEqual(await search(OTHER_TYPE), [])
    })

    it('gets responses from two servers that run in two processes', async function () {
      const udns = [newUdn(), newUdn()]

      for (const udn of udns) {
        const server = await machine.server({ udn }, [TYPE])
        await server.start()
      }

      assert.deepEqual(sources(await search(TYPE)), throughEveryInterface(udns.map((udn) => udn + '::' + TYPE)))
    })

    it('gets a response from every server in a cluster', async function () {
      const udns = [newUdn(), newUdn()]
      const cluster = await machine.cluster({}, [TYPE], udns)
      await cluster.start()

      assert.deepEqual(sources(await search(TYPE)), throughEveryInterface(udns.map((udn) => udn + '::' + TYPE)))
    })

    it('gets a response within the MX time from a server that waits before it answers', async function () {
      const udn = newUdn()
      const server = await machine.server({ udn, mxDelay: true }, [TYPE])
      await server.start()

      // The client sends MX 3. The rest is room for a slow machine.
      assert.deepEqual(sources(await search(TYPE, 3500)), throughEveryInterface([udn + '::' + TYPE]))
    })

    it('gets a response from a server that stopped and started again', async function () {
      const udn = newUdn()
      const server = await machine.server({ udn }, [TYPE])
      await server.start()
      await server.stop()
      await server.start()

      assert.deepEqual(sources(await search(TYPE)), throughEveryInterface([udn + '::' + TYPE]))
    })

    it('gets a response through the interface that the server names in its interfaces option', async function () {
      const udn = newUdn()
      const nic = externalIPv4().find((nic) => nic.address === addresses[0])
      const server = await machine.server({ udn, interfaces: [nic.name], location: LOCATION }, [TYPE])
      await server.start()

      const responses = (await search(TYPE)).filter((response) => response.rinfo.address === nic.address)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].headers.LOCATION, 'http://' + nic.address + ':8080/desc.xml')
    })
  })

  context('when a server advertises', function () {
    it('sends ssdp:alive through every interface, with the address of that interface in LOCATION', async function () {
      const udn = newUdn()
      const probe = await machine.probe()
      const server = await machine.server({ udn, adInterval: 200, location: LOCATION }, [TYPE])
      await server.start()

      await probe.waitFor('packet', isNotify('ssdp:alive'), 1500)
      // Look at a few rounds of advertisements, not only at the first packet.
      await probe.during('packet', 600)

      const alives = probe.events.filter(isNotify('ssdp:alive'))

      assert.deepEqual([...new Set(sources(alives))], throughEveryInterface([udn, udn + '::' + TYPE]))

      alives.forEach((alive) => {
        assert.equal(alive.headers.LOCATION, 'http://' + alive.rinfo.address + ':8080/desc.xml')
      })
    })

    it('sends ssdp:byebye through every interface when it stops', async function () {
      const udn = newUdn()
      const probe = await machine.probe()
      const server = await machine.server({ udn, adInterval: 200 }, [TYPE])
      await server.start()
      await probe.waitFor('packet', isNotify('ssdp:alive'), 1500)

      const [packets] = await Promise.all([probe.during('packet', 800), server.stop()])

      assert.deepEqual(sources(packets.filter(isNotify('ssdp:byebye'))), throughEveryInterface([udn, udn + '::' + TYPE]))
    })

    it('a client emits advertise-alive, and advertise-bye when the server stops', async function () {
      const udn = newUdn()
      const client = await machine.client()
      await client.start()

      const server = await machine.server({ udn, adInterval: 200 }, [TYPE])
      await server.start()
      await client.waitFor('advertise-alive', (event) => event.headers.USN === udn + '::' + TYPE, 1500)

      const [byes] = await Promise.all([client.during('advertise-bye', 800), server.stop()])

      assert.deepEqual(sources(byes.filter(ours)), throughEveryInterface([udn, udn + '::' + TYPE]))
    })
  })
})
