'use strict'

const assert = require('node:assert/strict')
const { Lab } = require('./support/lab')

const GROUP = '239.255.255.250'
const UDN = 'uuid:11111111-1111-1111-1111-111111111111'
const OTHER_UDN = 'uuid:22222222-2222-2222-2222-222222222222'
const ROOT = 'upnp:rootdevice'
const LOCATION = { port: 8080, path: '/desc.xml' }

function isAlive (packet) {
  return packet.startLine === 'NOTIFY * HTTP/1.1' && packet.headers.NTS === 'ssdp:alive'
}

function isSearch (packet) {
  return packet.startLine === 'M-SEARCH * HTTP/1.1'
}

// Two lans that are not connected to each other.
//
//   lan1 --- one              two --- lan2
//    |                                 |
//    +------ eth0 [ both ] eth1 -------+
//
// `both` has an interface on each lan. Its default route uses eth0 (lan1).
// `one` and `two` have one interface each.
describe('SSDP on a machine with two network interfaces', function () {
  let lab, lan1, lan2, both, one, two

  before(function () {
    lab = new Lab()
    lan1 = lab.addLan()
    lan2 = lab.addLan()
    both = lab.addHost([lan1, lan2])
    one = lab.addHost([lan1])
    two = lab.addHost([lan2])
  })

  afterEach(function () {
    return lab.closePeers()
  })

  after(function () {
    return lab && lab.destroy()
  })

  // Starts a server on `both` and checks the ssdp:alive packets on each lan.
  async function checkAliveOnBothLans (opts) {
    const wires = [[await one.probe(), lan1], [await two.probe(), lan2]]

    const server = await both.server(Object.assign({ udn: UDN, location: LOCATION, adInterval: 200 }, opts), [ROOT])
    await server.start()

    for (const [wire, lan] of wires) {
      await wire.waitFor('packet', isAlive, 1500)
      // Look at a few rounds of advertisements, not only at the first packet.
      await wire.during('packet', 500)

      wire.events.filter(isAlive).forEach((alive) => {
        assert.equal(alive.rinfo.address, both.address(lan))
        assert.equal(alive.headers.LOCATION, 'http://' + both.address(lan) + ':8080/desc.xml')
      })
    }
  }

  // Starts a client on `both`, lets it search, and returns the M-SEARCH
  // packets seen on each lan.
  async function searchesOnBothLans (opts) {
    const wire1 = await one.probe()
    const wire2 = await two.probe()

    const client = await both.client(opts)
    await client.search(ROOT)

    return [wire1.events.filter(isSearch), wire2.events.filter(isSearch)]
  }

  // Starts a server on `one` and on `two`, and returns what a client on
  // `both` finds.
  async function findServersOnBothLans (opts) {
    const server1 = await one.server({ udn: UDN }, [ROOT])
    const server2 = await two.server({ udn: OTHER_UDN }, [ROOT])
    await server1.start()
    await server2.start()

    const client = await both.client(opts)
    const responses = await client.search(ROOT)

    return responses.map((response) => response.rinfo.address + ' ' + response.headers.USN).sort()
  }

  context('server with default options', function () {
    it('joins the SSDP group on both interfaces', async function () {
      const server = await both.server({ udn: UDN })
      await server.start()

      assert(both.groups(lan1).includes(GROUP))
      assert(both.groups(lan2).includes(GROUP))
    })

    it('answers a search from each lan with one response', async function () {
      const server = await both.server({ udn: UDN, location: LOCATION }, [ROOT])
      await server.start()

      const client1 = await one.client()
      const client2 = await two.client()

      assert.equal((await client1.search(ROOT)).length, 1)
      assert.equal((await client2.search(ROOT)).length, 1)
    })

    it('answers with its address on the lan of the client in LOCATION', async function () {
      const server = await both.server({ udn: UDN, location: LOCATION }, [ROOT])
      await server.start()

      for (const [host, lan] of [[one, lan1], [two, lan2]]) {
        const client = await host.client()
        const responses = await client.search(ROOT)

        assert.notEqual(responses.length, 0)

        responses.forEach((response) => {
          assert.equal(response.headers.LOCATION, 'http://' + both.address(lan) + ':8080/desc.xml')
        })
      }
    })

    it('sends ssdp:alive to each lan, with its address on that lan in LOCATION', function () {
      return checkAliveOnBothLans({})
    })

    it('emits advertise-alive once for one NOTIFY', async function () {
      const server = await both.server({ udn: UDN })
      await server.start()

      const probe = await one.probe()
      const usn = OTHER_UDN + '::' + ROOT

      const [alives] = await Promise.all([
        server.during('advertise-alive', 300),
        probe.send([
          'NOTIFY * HTTP/1.1',
          'HOST: ' + GROUP + ':1900',
          'NT: ' + ROOT,
          'NTS: ssdp:alive',
          'USN: ' + usn
        ])
      ])

      assert.equal(alives.filter((alive) => alive.headers.USN === usn).length, 1)
    })

    it('starts when the system does not let it join the SSDP group on every interface', async function () {
      // One socket can now have one membership. The second interface is one
      // too many.
      both.sysctl('net.ipv4.igmp_max_memberships', 1)

      try {
        const server = await both.server({ udn: UDN, location: LOCATION }, [ROOT])
        await server.start()

        const client = await one.client()

        assert.equal((await client.search(ROOT)).length, 1)
      } finally {
        both.sysctl('net.ipv4.igmp_max_memberships', 20)
      }
    })
  })

  context('server with the interfaces option', function () {
    it('joins the SSDP group only on the named interface', async function () {
      const server = await both.server({ udn: UDN, interfaces: [both.ifname(lan2)] })
      await server.start()

      assert(!both.groups(lan1).includes(GROUP))
      assert(both.groups(lan2).includes(GROUP))
    })

    it('answers only searches from the lan of the named interface', async function () {
      const server = await both.server({ udn: UDN, location: LOCATION, interfaces: [both.ifname(lan2)] }, [ROOT])
      await server.start()

      const client1 = await one.client()
      const client2 = await two.client()

      assert.deepEqual(await client1.search(ROOT), [])

      const responses = await client2.search(ROOT)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].headers.LOCATION, 'http://' + both.address(lan2) + ':8080/desc.xml')
    })
  })

  context('server with explicitSocketBind', function () {
    it('sends ssdp:alive to each lan, with its address on that lan in LOCATION', function () {
      return checkAliveOnBothLans({ explicitSocketBind: true })
    })

    it('answers a search from each lan with one response', async function () {
      const server = await both.server({ udn: UDN, location: LOCATION, explicitSocketBind: true }, [ROOT])
      await server.start()

      const client1 = await one.client()
      const client2 = await two.client()

      assert.equal((await client1.search(ROOT)).length, 1)
      assert.equal((await client2.search(ROOT)).length, 1)
    })
  })

  context('client with default options', function () {
    it('joins the SSDP group on both interfaces', async function () {
      const client = await both.client()
      await client.start()

      assert(both.groups(lan1).includes(GROUP))
      assert(both.groups(lan2).includes(GROUP))
    })

    it('sends one search to each lan', async function () {
      const [searches1, searches2] = await searchesOnBothLans()

      assert.deepEqual(searches1.map((packet) => packet.rinfo.address), [both.address(lan1)])
      assert.deepEqual(searches2.map((packet) => packet.rinfo.address), [both.address(lan2)])
    })

    it('finds servers on both lans', async function () {
      assert.deepEqual(await findServersOnBothLans(), [
        one.address(lan1) + ' ' + UDN + '::' + ROOT,
        two.address(lan2) + ' ' + OTHER_UDN + '::' + ROOT
      ])
    })

    it('emits advertise-alive for servers on both lans', async function () {
      const client = await both.client()
      await client.start()

      const server1 = await one.server({ udn: UDN, adInterval: 200 }, [ROOT])
      const server2 = await two.server({ udn: OTHER_UDN, adInterval: 200 }, [ROOT])
      await server1.start()
      await server2.start()

      await client.waitFor('advertise-alive', (event) => event.rinfo.address === one.address(lan1))
      await client.waitFor('advertise-alive', (event) => event.rinfo.address === two.address(lan2))
    })
  })

  context('client with explicitSocketBind', function () {
    it('sends one search to each lan', async function () {
      const [searches1, searches2] = await searchesOnBothLans({ explicitSocketBind: true })

      assert.deepEqual(searches1.map((packet) => packet.rinfo.address), [both.address(lan1)])
      assert.deepEqual(searches2.map((packet) => packet.rinfo.address), [both.address(lan2)])
    })

    it('finds servers on both lans', async function () {
      assert.deepEqual(await findServersOnBothLans({ explicitSocketBind: true }), [
        one.address(lan1) + ' ' + UDN + '::' + ROOT,
        two.address(lan2) + ' ' + OTHER_UDN + '::' + ROOT
      ])
    })
  })
})
