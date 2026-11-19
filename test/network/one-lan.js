'use strict'

const assert = require('node:assert/strict')
const { Lab } = require('./support/lab')

const GROUP = '239.255.255.250'
const UDN = 'uuid:11111111-1111-1111-1111-111111111111'
const OTHER_UDN = 'uuid:22222222-2222-2222-2222-222222222222'
const ROOT = 'upnp:rootdevice'
const MEDIA = 'urn:schemas-upnp-org:device:MediaServer:1'
const SIGNATURE = /^node\.js\/\S+ UPnP\/1\.1 node-ssdp\/\S+$/

function isNotify (nts) {
  return function (packet) {
    return packet.startLine === 'NOTIFY * HTTP/1.1' && packet.headers.NTS === nts
  }
}

// Four machines on one lan. Each has one network interface.
// The interface of `aliased` has three addresses.
describe('SSDP between machines on one lan', function () {
  let lab, lan, device, control, third, aliased

  before(function () {
    lab = new Lab()
    lan = lab.addLan()
    device = lab.addHost([lan])
    control = lab.addHost([lan])
    third = lab.addHost([lan])

    aliased = lab.addHost([lan])
    aliased.addAddress(lan, lan.prefix + '.101/24')
    aliased.addAddress(lan, '192.168.77.1/24', aliased.ifname(lan) + ':1')
  })

  afterEach(function () {
    return lab.closePeers()
  })

  after(function () {
    return lab && lab.destroy()
  })

  context('when a client searches', function () {
    it('gets one response for every USN of the server when it asks for ssdp:all', async function () {
      const server = await device.server({ udn: UDN, location: 'http://device.test/desc.xml' }, [ROOT, MEDIA])
      await server.start()

      const client = await control.client()
      const responses = await client.search('ssdp:all')

      assert.deepEqual(
        responses.map((response) => response.headers.ST + ' ' + response.headers.USN).sort(),
        [
          MEDIA + ' ' + UDN + '::' + MEDIA,
          ROOT + ' ' + UDN + '::' + ROOT,
          UDN + ' ' + UDN
        ].sort()
      )

      responses.forEach((response) => {
        assert.equal(response.statusCode, 200)
        assert.equal(response.rinfo.address, device.address(lan))
        assert.equal(response.rinfo.port, 1900)
        assert.equal(response.headers.LOCATION, 'http://device.test/desc.xml')
        assert.equal(response.headers['CACHE-CONTROL'], 'max-age=1800')
        assert.equal(response.headers.EXT, '')
        assert.match(response.headers.SERVER, SIGNATURE)
        assert.match(response.headers.DATE, /^\w+, \d+ \w+ \d+ [\d:]+ GMT$/)
      })
    })

    it('gets only the matching response when it asks for one type', async function () {
      const server = await device.server({ udn: UDN }, [ROOT, MEDIA])
      await server.start()

      const client = await control.client()
      const responses = await client.search(MEDIA)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].headers.ST, MEDIA)
      assert.equal(responses[0].headers.USN, UDN + '::' + MEDIA)
    })

    it('gets no response when no server has the type', async function () {
      const server = await device.server({ udn: UDN }, [ROOT, MEDIA])
      await server.start()

      const client = await control.client()
      const responses = await client.search('urn:schemas-upnp-org:device:Toaster:1')

      assert.deepEqual(responses, [])
    })

    it('gets a response for a wildcard type when the server allows wildcards', async function () {
      const server = await device.server({ udn: UDN, allowWildcards: true }, [MEDIA])
      await server.start()

      const client = await control.client()
      const responses = await client.search('urn:schemas-upnp-org:device:*')

      assert.equal(responses.length, 1)
      assert.equal(responses[0].rinfo.address, device.address(lan))
    })

    it('gets responses from servers on two machines', async function () {
      const first = await device.server({ udn: UDN }, [ROOT])
      const second = await third.server({ udn: OTHER_UDN }, [ROOT])
      await first.start()
      await second.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.deepEqual(
        responses.map((response) => response.rinfo.address + ' ' + response.headers.USN).sort(),
        [
          device.address(lan) + ' ' + UDN + '::' + ROOT,
          third.address(lan) + ' ' + OTHER_UDN + '::' + ROOT
        ].sort()
      )
    })

    it('gets responses from two servers that run on the same machine', async function () {
      const first = await device.server({ udn: UDN }, [ROOT])
      const second = await device.server({ udn: OTHER_UDN }, [ROOT])
      await first.start()
      await second.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.deepEqual(
        responses.map((response) => response.headers.USN).sort(),
        [UDN + '::' + ROOT, OTHER_UDN + '::' + ROOT]
      )
    })

    it('gets the address of the server in LOCATION when the server has no location option', async function () {
      const server = await device.server({ udn: UDN }, [ROOT])
      await server.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].headers.LOCATION, 'http://' + device.address(lan) + ':10293/upnp/desc.html')
    })

    it('gets the address of the server in LOCATION when the location option is an object', async function () {
      const server = await device.server({ udn: UDN, location: { port: 8080, path: '/desc.xml' } }, [ROOT])
      await server.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].headers.LOCATION, 'http://' + device.address(lan) + ':8080/desc.xml')
    })
  })

  context('when a plain UDP socket searches', function () {
    it('gets a response from the server', async function () {
      const server = await device.server({ udn: UDN }, [ROOT])
      await server.start()

      const probe = await control.probe()

      await probe.send([
        'M-SEARCH * HTTP/1.1',
        'HOST: ' + GROUP + ':1900',
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: ' + ROOT
      ])

      const response = await probe.waitFor('packet', (packet) => packet.startLine === 'HTTP/1.1 200 OK')

      assert.equal(response.rinfo.address, device.address(lan))
      assert.equal(response.headers.ST, ROOT)
      assert.equal(response.headers.USN, UDN + '::' + ROOT)
    })

    it('gets a response within the MX time from a server that waits before it answers', async function () {
      const server = await device.server({ udn: UDN, mxDelay: true }, [ROOT])
      await server.start()

      const probe = await control.probe()

      await probe.send([
        'M-SEARCH * HTTP/1.1',
        'HOST: ' + GROUP + ':1900',
        'MAN: "ssdp:discover"',
        'MX: 1',
        'ST: ' + ROOT
      ])

      // MX is 1 second. The rest is room for a slow machine.
      await probe.waitFor('packet', (packet) => packet.startLine === 'HTTP/1.1 200 OK', 1500)
    })
  })

  context('when a server advertises', function () {
    it('sends ssdp:alive for every USN to the SSDP group', async function () {
      const probe = await control.probe()

      const server = await device.server({ udn: UDN, adInterval: 200, location: { port: 8080, path: '/desc.xml' } }, [ROOT])
      await server.start()

      for (const [nt, usn] of [[ROOT, UDN + '::' + ROOT], [UDN, UDN]]) {
        const alive = await probe.waitFor('packet', (packet) => isNotify('ssdp:alive')(packet) && packet.headers.NT === nt)

        assert.equal(alive.rinfo.address, device.address(lan))
        assert.equal(alive.headers.HOST, GROUP + ':1900')
        assert.equal(alive.headers.USN, usn)
        assert.equal(alive.headers.LOCATION, 'http://' + device.address(lan) + ':8080/desc.xml')
        assert.equal(alive.headers['CACHE-CONTROL'], 'max-age=1800')
        assert.match(alive.headers.SERVER, SIGNATURE)
      }
    })

    it('sends ssdp:byebye for every USN to the SSDP group when it stops', async function () {
      const probe = await control.probe()

      const server = await device.server({ udn: UDN, adInterval: 200 }, [ROOT])
      await server.start()
      await probe.waitFor('packet', isNotify('ssdp:alive'))

      const [packets] = await Promise.all([probe.during('packet', 500), server.stop()])
      const byes = packets.filter(isNotify('ssdp:byebye'))

      assert.deepEqual(
        byes.map((bye) => bye.headers.NT + ' ' + bye.headers.USN).sort(),
        [ROOT + ' ' + UDN + '::' + ROOT, UDN + ' ' + UDN].sort()
      )

      byes.forEach((bye) => assert.equal(bye.rinfo.address, device.address(lan)))
    })
  })

  context('when another device advertises', function () {
    it('a server emits advertise-alive', async function () {
      const listener = await control.server({ udn: OTHER_UDN })
      await listener.start()

      const server = await device.server({ udn: UDN, adInterval: 200 }, [ROOT])
      await server.start()

      const alive = await listener.waitFor('advertise-alive', (event) => event.headers.USN === UDN + '::' + ROOT)

      assert.equal(alive.rinfo.address, device.address(lan))
      assert.equal(alive.headers.NT, ROOT)
      assert.equal(alive.headers.NTS, 'ssdp:alive')
    })

    it('a server emits advertise-bye', async function () {
      const listener = await control.server({ udn: OTHER_UDN })
      await listener.start()

      const probe = await device.probe()

      await probe.send([
        'NOTIFY * HTTP/1.1',
        'HOST: ' + GROUP + ':1900',
        'NT: ' + ROOT,
        'NTS: ssdp:byebye',
        'USN: ' + UDN + '::' + ROOT
      ])

      const bye = await listener.waitFor('advertise-bye')

      assert.equal(bye.rinfo.address, device.address(lan))
      assert.equal(bye.headers.NT, ROOT)
      assert.equal(bye.headers.USN, UDN + '::' + ROOT)
    })

    it('a client emits advertise-alive', async function () {
      const client = await control.client()
      await client.start()

      const server = await device.server({ udn: UDN, adInterval: 200 }, [ROOT])
      await server.start()

      const alive = await client.waitFor('advertise-alive', (event) => event.headers.USN === UDN + '::' + ROOT)

      assert.equal(alive.rinfo.address, device.address(lan))
    })

    // With this port, every socket of the client gets a copy of each NOTIFY.
    it('a client whose sourcePort is the SSDP port emits advertise-alive once for one NOTIFY', async function () {
      const client = await control.client({ sourcePort: 1900 })
      await client.start()

      const probe = await device.probe()

      const [alives] = await Promise.all([
        client.during('advertise-alive', 300),
        probe.send([
          'NOTIFY * HTTP/1.1',
          'HOST: ' + GROUP + ':1900',
          'NT: ' + ROOT,
          'NTS: ssdp:alive',
          'USN: ' + UDN + '::' + ROOT
        ])
      ])

      assert.equal(alives.length, 1)
    })
  })

  context('when another program holds the SSDP port', function () {
    it('start fails', async function () {
      const first = await device.server({ udn: UDN, reuseAddr: false })
      await first.start()

      const second = await device.server({ udn: OTHER_UDN, reuseAddr: false })

      await assert.rejects(second.start(), /EADDRINUSE/)
    })
  })

  context('when an interface has several addresses', function () {
    it('a server starts and answers a search once', async function () {
      const server = await aliased.server({ udn: UDN, location: { port: 8080, path: '/desc.xml' } }, [ROOT])
      await server.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.equal(responses.length, 1)
      assert.equal(responses[0].rinfo.address, aliased.address(lan))
      assert.equal(responses[0].headers.LOCATION, 'http://' + aliased.address(lan) + ':8080/desc.xml')
    })
  })

  context('when servers run in cluster workers of one process', function () {
    it('every server starts and answers a search', async function () {
      const servers = await device.cluster({}, [ROOT], [UDN, OTHER_UDN])
      await servers.start()

      const client = await control.client()
      const responses = await client.search(ROOT)

      assert.deepEqual(
        responses.map((response) => response.headers.USN).sort(),
        [UDN + '::' + ROOT, OTHER_UDN + '::' + ROOT]
      )
    })
  })

  context('multicast group membership', function () {
    it('a server joins the SSDP group when it starts and leaves it when it stops', async function () {
      const server = await device.server({ udn: UDN })

      assert(!device.groups(lan).includes(GROUP))

      await server.start()
      assert(device.groups(lan).includes(GROUP))

      await server.stop()
      assert(!device.groups(lan).includes(GROUP))
    })

    it('a client joins the SSDP group when it starts and leaves it when it stops', async function () {
      const client = await control.client()

      await client.start()
      assert(control.groups(lan).includes(GROUP))

      await client.stop()
      assert(!control.groups(lan).includes(GROUP))
    })
  })
})
