require('../helper')

var assert = require('chai').assert
var os = require('os')

var moduleVersion = require('../../package.json').version
var Server = require('../../lib/server')

// First external IPv4 address of this machine.
// The server puts it into LOCATION when the user gives no host.
function localIp() {
  var interfaces = os.networkInterfaces()

  for (var name of Object.keys(interfaces)) {
    for (var info of interfaces[name]) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }
}

// One entry of `os.networkInterfaces()`.
function ipv4(address) {
  return {address: address, netmask: '255.255.255.0', family: 'IPv4', internal: false}
}

// The error that the system gives while an interface is not present yet.
function notReady() {
  var error = new Error('addMembership ENODEV')

  error.code = 'ENODEV'

  return error
}

describe('Server', function () {
  context('on construction', function () {
    it('preserves user-set sourcePort', function () {
      var server = new Server({sourcePort: 'wrong port!'})
      assert.equal(server._sourcePort, 'wrong port!')
    })
  })

  context('on start', function () {
    it('binds the listener to the SSDP port and the other sockets to any port', function () {
      var server = new Server()
      server.start()

      assert(server._listener.bind.calledOnce)
      assert.equal(server._listener.bind.getCall(0).args[0].port, 1900)

      Object.keys(server.sockets).forEach(function (iface) {
        assert.equal(server.sockets[iface].bind.getCall(0).args[0].port, 0)
      })
    })

    it('binds sockets without interface by default', function () {
      var server = new Server()
      server.start()

      var ifaces = Object.keys(server.sockets)

      ifaces.forEach(function (iface) {
        var socket = server.sockets[iface]

        assert.equal(socket.bind.getCall(0).args[0].address, undefined)
      })
    })

    it('binds sockets to interface when explicit bind is requested', function () {
      var server = new Server({explicitSocketBind: true})
      server.start()

      var ifaces = Object.keys(server.sockets)

      ifaces.forEach(function (iface) {
        var socket = server.sockets[iface]

        assert.equal(socket.bind.getCall(0).args[0].address, iface)
      })
    })

    it('does not allow double-binding on the socket', function () {
      var server = new Server()

      server.start()
      server.start()
      server.start()

      var iface = Object.keys(server.sockets)[0]

      assert(server.sockets[iface].bind.calledOnce)
      assert(server._listener.bind.calledOnce)
    })

    it('takes optional callback', function (done) {
      var server = new Server();
      server.start(function () {
        assert(true);
        done();
      });
    })

    it('returs a promise', function (done) {
      var server = new Server();
      server.start().then(function () {
        assert(true);
        done();
      });
    })

    it('joins the multicast group once on every interface', function () {
      // en0 has three addresses. Linux lists an address that has a label
      // under its own name.
      this.sinon.stub(os, 'networkInterfaces').returns({
        'en0': [ipv4('192.168.1.1'), ipv4('192.168.1.2')],
        'en0:1': [ipv4('192.168.2.1')],
        'en1': [ipv4('10.0.0.1')]
      })

      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!'})
      server.start()

      assert.deepEqual(server._listener.addMembership.args, [
        ['fake ip', '192.168.1.1'],
        ['fake ip', '10.0.0.1']
      ])

      var ifaces = Object.keys(server.sockets)

      assert.deepEqual(ifaces, ['192.168.1.1', '192.168.1.2', '192.168.2.1', '10.0.0.1'])

      ifaces.forEach(function (iface) {
        var socket = server.sockets[iface]

        assert.equal(socket.setMulticastTTL.callCount, 1)
        assert(socket.setMulticastTTL.calledWith('never!'))

        assert.equal(socket.setMulticastInterface.callCount, 1)
        assert(socket.setMulticastInterface.calledWith(iface))
      })
    })

    it('skips an interface that cannot join the multicast group and warns about it', async function () {
      this.sinon.stub(os, 'networkInterfaces').returns({
        'en0': [ipv4('192.168.1.1')],
        'en1': [ipv4('10.0.0.1')]
      })

      this.sinon.stub(process, 'emitWarning')

      var server = new Server()
      // cheating but otherwise cannot make the listener fail
      server._createSockets()

      server._listener.addMembership
        .withArgs('239.255.255.250', '192.168.1.1')
        .throws(new Error('addMembership EHOSTUNREACH'))

      await server.start()

      assert(server._listener.addMembership.calledWith('239.255.255.250', '10.0.0.1'))

      assert(process.emitWarning.calledOnce)
      assert.match(process.emitWarning.getCall(0).args[0], /en0 \(192\.168\.1\.1\).*EHOSTUNREACH/)
    })

    it('fails when no interface can join the multicast group', async function () {
      this.sinon.stub(os, 'networkInterfaces').returns({
        'en0': [ipv4('192.168.1.1')],
        'en1': [ipv4('10.0.0.1')]
      })

      this.sinon.stub(process, 'emitWarning')

      var server = new Server()
      // cheating but otherwise cannot make the listener fail
      server._createSockets()

      var error = new Error('addMembership EHOSTUNREACH')
      var listener = server._listener

      listener.addMembership.throws(error)

      var failure = await server.start().then(function () {}, function (e) { return e })

      assert.equal(failure, error)
      assert(listener.close.calledOnce)
      assert(!server.sockets)
    })

    context('when an interface is not present yet', function () {
      var clock

      beforeEach(function () {
        clock = this.sinon.useFakeTimers()
        this.sinon.stub(process, 'emitWarning')
      })

      it('finishes after the second try when no other interface has joined', function () {
        this.sinon.stub(os, 'networkInterfaces').returns({
          'en0': [ipv4('192.168.1.1')]
        })

        var server = new Server()
        // cheating but otherwise cannot make the listener fail
        server._createSockets()

        server._listener.addMembership.onFirstCall().throws(notReady())

        var started = this.sinon.stub()

        server.start(started)

        assert(started.notCalled)

        clock.tick(5000)

        assert(started.calledOnce)
        assert.equal(started.getCall(0).args[0], undefined)
        assert.equal(server._listener.addMembership.callCount, 2)
      })

      it('fails after the second try when that fails too', function () {
        this.sinon.stub(os, 'networkInterfaces').returns({
          'en0': [ipv4('192.168.1.1')]
        })

        var server = new Server()
        // cheating but otherwise cannot make the listener fail
        server._createSockets()

        var error = notReady()
        var listener = server._listener

        listener.addMembership.throws(error)

        var started = this.sinon.stub()

        server.start(started).catch(function () {})

        assert(started.notCalled)

        clock.tick(5000)

        assert(started.calledOnce)
        assert.equal(started.getCall(0).args[0], error)
        assert(listener.close.calledOnce)
        assert(!server.sockets)
      })

      it('does not wait for the second try when another interface has joined', function () {
        this.sinon.stub(os, 'networkInterfaces').returns({
          'en0': [ipv4('192.168.1.1')],
          'en1': [ipv4('10.0.0.1')]
        })

        var server = new Server()
        // cheating but otherwise cannot make the listener fail
        server._createSockets()

        server._listener.addMembership
          .withArgs('239.255.255.250', '192.168.1.1')
          .throws(notReady())

        var started = this.sinon.stub()

        server.start(started)

        assert(started.calledOnce)
        assert.equal(started.getCall(0).args[0], undefined)
      })
    })

    it('starts advertising every n milliseconds', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers
      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!', 'adInterval': adInterval})
      server.addUSN('tv/video')
      server.start()

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      clock.tick(500)

      // it's 4 because we call `advertise` immediately after bind. Lame.
      assert.equal(socket.send.callCount, 2)

      clock.tick(500)

      assert.equal(socket.send.callCount, 4)
    })
  })

  context('on stop', function () {
    it('does not allow multiple _stops', async function () {
      var server = new Server()
      await server.start()

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      assert(socket.bind.calledOnce)

      await Promise.all([server.stop(), server.stop(), server.stop()])

      assert(!server.sockets)
      assert.equal(socket.close.callCount, 1)

      await server.stop()

      assert.equal(socket.close.callCount, 1)
    })
  })

  context('when advertising', function () {
    it('sends out correct alive info', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers

      var server = new Server({
        ssdpIp: 'ip',
        ssdpTtl: 'never',
        unicastHost: 'unicast',
        location: 'location header',
        adInterval: adInterval,
        ssdpSig: 'signature',
        ttl: 'ttl',
        description: 'desc',
        udn: 'device name'
      })

      var _advertise = server.advertise

      this.sinon.stub(server, 'advertise').callsFake(function (alive) {
        if (alive === false) return
        _advertise.call(server)
      })

      server.addUSN('tv/video')

      server.start()

      clock.tick(500)

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      // server.sock.send should've been called 2 times with 2 unique args
      assert.equal(socket.send.callCount, 2)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = socket.send.getCall(0).args

      var method1 = server._getMethod(args1[0].toString())
      assert(method1, 'NOTIFY')

      var headers1 = server._getHeaders(args1[0].toString())
      assert.equal(headers1.HOST, 'ip:1900')
      assert.equal(headers1.NT, 'tv/video')
      assert.equal(headers1.NTS, 'ssdp:alive')
      assert.equal(headers1.USN, 'device name::tv/video')
      assert.equal(headers1.LOCATION, 'location header')
      assert.equal(headers1['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers1.SERVER, 'signature')

      var port1 = args1[3]
      assert.equal(port1, 1900)

      var host1 = args1[4]
      assert.equal(host1, 'ip')

      var args2 = socket.send.getCall(1).args

      var method2 = server._getMethod(args2[0].toString())
      assert(method2, 'NOTIFY')

      var headers2 = server._getHeaders(args2[0].toString())
      assert.equal(headers2.HOST, 'ip:1900')
      assert.equal(headers2.NT, 'device name')
      assert.equal(headers2.NTS, 'ssdp:alive')
      assert.equal(headers2.USN, 'device name')
      assert.equal(headers2.LOCATION, 'location header')
      assert.equal(headers2['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers2.SERVER, 'signature')

      var port2 = args2[3]
      assert.equal(port2, 1900)

      var host2 = args2[4]
      assert.equal(host2, 'ip')
    })

    it('uses location object is set by user', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers

      var server = new Server({
        ssdpIp: 'ip',
        ssdpTtl: 'never',
        unicastHost: 'unicast',
        location: {
          port: 111,
          path: '/location/path'
        },
        adInterval: adInterval,
        ssdpSig: 'signature',
        ttl: 'ttl',
        description: 'desc',
        udn: 'device name'
      })

      var _advertise = server.advertise

      this.sinon.stub(server, 'advertise').callsFake(function (alive) {
        if (alive === false) return
        _advertise.call(server)
      })

      server.addUSN('tv/video')

      server.start()

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      clock.tick(500)

      // server.sock.send should've been called 2 times with 2 unique args
      assert.equal(socket.send.callCount, 2)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = socket.send.getCall(0).args

      var method1 = server._getMethod(args1[0].toString())
      assert(method1, 'NOTIFY')

      var headers1 = server._getHeaders(args1[0].toString())
      assert.equal(headers1.HOST, 'ip:1900')
      assert.equal(headers1.NT, 'tv/video')
      assert.equal(headers1.NTS, 'ssdp:alive')
      assert.equal(headers1.USN, 'device name::tv/video')
      assert.equal(headers1.LOCATION, 'http://' + localIp() + ':111/location/path')
      assert.equal(headers1['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers1.SERVER, 'signature')

      var port1 = args1[3]
      assert.equal(port1, 1900)

      var host1 = args1[4]
      assert.equal(host1, 'ip')

      var args2 = socket.send.getCall(1).args

      var method2 = server._getMethod(args2[0].toString())
      assert(method2, 'NOTIFY')

      var headers2 = server._getHeaders(args2[0].toString())
      assert.equal(headers2.HOST, 'ip:1900')
      assert.equal(headers2.NT, 'device name')
      assert.equal(headers2.NTS, 'ssdp:alive')
      assert.equal(headers2.USN, 'device name')
      assert.equal(headers1.LOCATION, 'http://' + localIp() + ':111/location/path')
      assert.equal(headers2['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers2.SERVER, 'signature')

      var port2 = args2[3]
      assert.equal(port2, 1900)

      var host2 = args2[4]
      assert.equal(host2, 'ip')
    })

    it('includes extra headers in alive message', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers

      var server = new Server({
        ssdpIp: 'ip',
        ssdpTtl: 'never',
        unicastHost: 'unicast',
        location: 'location header',
        adInterval: adInterval,
        ssdpSig: 'signature',
        ttl: 'ttl',
        description: 'desc',
        udn: 'device name',
        headers: {
          FOO: 'bar',
          BAZ: 'qux'
        }
      })

      var _advertise = server.advertise

      this.sinon.stub(server, 'advertise').callsFake(function (alive) {
        if (alive === false) return
        _advertise.call(server)
      })

      server.addUSN('tv/video')

      server.start()

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      clock.tick(500)

      // server.sock.send should've been called 2 times with 2 unique args
      assert.equal(socket.send.callCount, 2)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = socket.send.getCall(0).args

      var method1 = server._getMethod(args1[0].toString())
      assert(method1, 'NOTIFY')

      var headers1 = server._getHeaders(args1[0].toString())
      assert.equal(headers1.HOST, 'ip:1900')
      assert.equal(headers1.NT, 'tv/video')
      assert.equal(headers1.NTS, 'ssdp:alive')
      assert.equal(headers1.USN, 'device name::tv/video')
      assert.equal(headers1.LOCATION, 'location header')
      assert.equal(headers1['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers1.SERVER, 'signature')
      assert.equal(headers1.FOO, 'bar')
      assert.equal(headers1.BAZ, 'qux')

      var port1 = args1[3]
      assert.equal(port1, 1900)

      var host1 = args1[4]
      assert.equal(host1, 'ip')

      var args2 = socket.send.getCall(1).args

      var method2 = server._getMethod(args2[0].toString())
      assert(method2, 'NOTIFY')

      var headers2 = server._getHeaders(args2[0].toString())
      assert.equal(headers2.HOST, 'ip:1900')
      assert.equal(headers2.NT, 'device name')
      assert.equal(headers2.NTS, 'ssdp:alive')
      assert.equal(headers2.USN, 'device name')
      assert.equal(headers2.LOCATION, 'location header')
      assert.equal(headers2['CACHE-CONTROL'], 'max-age=1800')
      assert.equal(headers2.SERVER, 'signature')
      assert.equal(headers2.FOO, 'bar')
      assert.equal(headers2.BAZ, 'qux')

      var port2 = args2[3]
      assert.equal(port2, 1900)

      var host2 = args2[4]
      assert.equal(host2, 'ip')
    })

    it('sends out correct byebye info, then closes the socket', async function () {
      var server = new Server({
        ssdpIp: 'ip',
        location: 'location header',
        udn: 'device name',
        suppressRootDeviceAdvertisements: true
      })

      server.addUSN('tv/video')

      await server.start()

      var iface = Object.keys(server.sockets)[0]
      var socket = server.sockets[iface]

      var stopped = server.stop()

      // The byebye is not sent yet, so the socket must still be open.
      assert.equal(socket.send.callCount, 1)
      assert(socket.close.notCalled)

      await stopped

      assert(socket.close.calledOnce)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = socket.send.getCall(0).args

      assert.equal(server._getMethod(args1[0].toString()), 'notify')

      var headers1 = server._getHeaders(args1[0].toString())
      assert.equal(headers1.HOST, 'ip:1900')
      assert.equal(headers1.NT, 'tv/video')
      assert.equal(headers1.NTS, 'ssdp:byebye')
      assert.equal(headers1.USN, 'device name::tv/video')
      assert.equal(headers1.LOCATION, undefined)
      assert.equal(headers1['CACHE-CONTROL'], undefined)
      assert.equal(headers1.SERVER, undefined)

      var port1 = args1[3]
      assert.equal(port1, 1900)

      var host1 = args1[4]
      assert.equal(host1, 'ip')
    })
  })

  context('when receiving a message with unknown command', function () {
    //FIXME Ctrl-C, Ctrl-V!
    var UNKNOWN_CMD = [
      'LOLWUT * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'NT: upnp:rootdevice',
      'NTS: ssdp:alive',
      'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::upnp:rootdevice',
      'LOCATION: http://192.168.1.1:10293/upnp/desc.html',
      'CACHE-CONTROL: max-age=1800',
      'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion
    ].join('\r\n')

    it('server emits nothing but logs it', function (done) {
      var server = new Server

      this.sinon.spy(server, 'emit')

      server.start()

      var socket = server._listener

      server._logger = function (message, data) {
        if (message.indexOf('Unhandled command') === -1) return

        assert.equal(data.rinfo.address, 1)
        assert.equal(data.rinfo.port, 2)

        assert(server.emit.notCalled)

        done()
      }

      socket.emit('message', UNKNOWN_CMD, {address: 1, port: 2})
    })
  })

  context('when receiving a NOTIFY message', function () {
    //FIXME Ctrl-C, Ctrl-V!
    var NOTIFY_ALIVE = [
      'NOTIFY * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'NT: upnp:rootdevice',
      'NTS: ssdp:alive',
      'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::upnp:rootdevice',
      'LOCATION: http://192.168.1.1:10293/upnp/desc.html',
      'CACHE-CONTROL: max-age=1800',
      'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion
    ].join('\r\n')

    var NOTIFY_BYE = [
      'NOTIFY * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'NT: upnp:rootdevice',
      'NTS: ssdp:byebye',
      'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::upnp:rootdevice'
    ].join('\r\n')

    var NOTIFY_WTF = [
      'NOTIFY * HTTP/1.1',
      'HOST: 239.255.255.250:1900',
      'NT: upnp:rootdevice',
      'NTS: WAT',
      'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::upnp:rootdevice'
    ].join('\r\n')

    it('with ssdp:alive server emits `advertise-alive` with data', function (done) {
      var server = new Server

      server.on('advertise-alive', function (headers) {
        ['HOST', 'NT', 'NTS', 'USN', 'LOCATION', 'CACHE-CONTROL', 'SERVER'].forEach(function (header) {
          assert(headers[header])
        })

        done()
      })

      server.start()

      var socket = server._listener

      socket.emit('message', NOTIFY_ALIVE, {address: 1, port: 2})
    })

    it('with ssdp:bye server emits `advertise-bye` with data', function (done) {
      var server = new Server

      server.on('advertise-bye', function (headers) {
        ['HOST', 'NT', 'NTS', 'USN'].forEach(function (header) {
          assert(headers[header])
        })

        done()
      })

      server.start()

      var socket = server._listener

      socket.emit('message', NOTIFY_BYE, {address: 1, port: 2})
    })

    it('with unknown NTS server emits nothing but logs it', function (done) {
      var server = new Server

      server.start()

      var socket = server._listener

      this.sinon.spy(server, 'emit')

      server._logger = function (message, data) {
        if (message.indexOf('Unhandled NOTIFY event') === -1) return

        assert.equal(data.rinfo.address, 1)
        assert.equal(data.rinfo.port, 2)

        assert(server.emit.notCalled)

        done()
      }

      socket.emit('message', NOTIFY_WTF, {address: 1, port: 2})
    })
  })

  context('when receiving an M-SEARCH message', function () {
    context('with the MX delay', function () {
      var clock, server, socket

      function search(mx) {
        return [
          'M-SEARCH * HTTP/1.1',
          'HOST: 239.255.255.250:1900',
          'ST: ssdp:all',
          'MAN: "ssdp:discover"',
          'MX: ' + mx
        ].join('\r\n')
      }

      beforeEach(function () {
        clock = this.sinon.useFakeTimers()

        this.sinon.stub(Math, 'random').returns(0.5)

        server = new Server

        server.advertise = this.sinon.stub() // otherwise it'll call `send`

        server.start()

        socket = server._listener
      })

      it('waits a random part of MX seconds before it replies', function () {
        socket.emit('message', search(3), {address: 1, port: 2})

        clock.tick(1499)
        assert(socket.send.notCalled)

        clock.tick(1)
        assert(socket.send.calledOnce)
      })

      it('treats an MX above 5 as 5', function () {
        socket.emit('message', search(120), {address: 1, port: 2})

        clock.tick(2499)
        assert(socket.send.notCalled)

        clock.tick(1)
        assert(socket.send.calledOnce)
      })

      it('does not reply when it was stopped in the meantime', function () {
        socket.emit('message', search(3), {address: 1, port: 2})

        server._stop()

        clock.tick(5000)
        assert(socket.send.notCalled)
      })
    })

    it('with unknown service type it\'s ignored', function (done) {
      var server = new Server({mxDelay: false})

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      var socket = server._listener

      this.sinon.spy(server, '_respondToSearch')

      var MS_UNKNOWN = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: toaster',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      socket.emit('message', MS_UNKNOWN, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(socket.send.notCalled)

      done()
    })

    it('with ssdp:all service type it replies with a unicast 200 OK', function (done) {
      var server = new Server({mxDelay: false})

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      var socket = server._listener

      this.sinon.spy(server, '_respondToSearch')

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: ssdp:all',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      socket.emit('message', MS_ALL, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(socket.send.calledOnce)

      var args = socket.send.getCall(0).args
        , message = args[0]
        , port = args[3]
        , ip = args[4]

      assert(Buffer.isBuffer(message))
      assert.equal(port, 2)
      assert.equal(ip, 1)

      var expectedMessage = [
        'HTTP/1.1 200 OK',
        'ST: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'LOCATION: http://' + localIp() + ':10293/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/' + process.versions.node + ' UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(filteredMessage.sort(), expectedMessage.sort())

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })

    it('replies once, with the address of the interface on the subnet of the sender in LOCATION', function () {
      this.sinon.stub(os, 'networkInterfaces').returns({
        en0:
          [
            {
              address: 'fe80::95:be02:727f:9f4a',
              netmask: 'ffff:ffff:ffff:ffff::',
              family: 'IPv6',
              mac: 'dc:a9:04:73:b2:b8',
              scopeid: 1,
              internal: false
            },
            {
              address: '192.168.1.1',
              netmask: '255.255.255.0',
              family: 'IPv4',
              mac: 'dc:a9:04:73:b2:b8',
              internal: false
            }
          ],
        en1:
          [
            {
              address: '10.0.0.1',
              netmask: '255.0.0.0',
              family: 'IPv4',
              mac: 'dc:a9:04:73:b2:b9',
              internal: false
            }
          ]
      })

      var server = new Server({
        mxDelay: false,
        location: {
          port: 123,
          path: '/hello/there'
        }
      })

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      var listener = server._listener

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: ssdp:all',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      function locationSentTo(address) {
        listener.send.resetHistory()
        listener.emit('message', MS_ALL, {address: address, port: 2})

        assert(listener.send.calledOnce)

        var args = listener.send.getCall(0).args

        assert.equal(args[3], 2)
        assert.equal(args[4], address)

        return server._getHeaders(args[0].toString()).LOCATION
      }

      assert.equal(locationSentTo('192.168.1.77'), 'http://192.168.1.1:123/hello/there')
      assert.equal(locationSentTo('10.20.30.40'), 'http://10.0.0.1:123/hello/there')

      // no interface is on the subnet of this sender, so the first one is used
      assert.equal(locationSentTo('172.16.0.5'), 'http://192.168.1.1:123/hello/there')

      Object.keys(server.sockets).forEach(function (iface) {
        assert(server.sockets[iface].send.notCalled)
      })
    })

    it('with matching wildcard it replies with a unicast 200 OK', function (done) {
      var server = new Server({allowWildcards: true, mxDelay: false})
      server.addUSN('urn:Manufacturer:device:controllee:1')

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      var socket = server._listener

      this.sinon.spy(server, '_respondToSearch')

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: urn:Manufacturer:device:*',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      socket.emit('message', MS_ALL, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(socket.send.calledOnce)

      var args = socket.send.getCall(0).args
        , message = args[0]
        , port = args[3]
        , ip = args[4]

      assert(Buffer.isBuffer(message))
      assert.equal(port, 2)
      assert.equal(ip, 1)

      var expectedMessage = [
        'HTTP/1.1 200 OK',
        'ST: urn:Manufacturer:device:*',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::urn:Manufacturer:device:*',
        'LOCATION: http://' + localIp() + ':10293/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/' + process.versions.node + ' UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(filteredMessage.sort(), expectedMessage.sort())

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })

    it('it includes extra headers in replies with a unicast 200 OK', function (done) {
      var server = new Server({
        mxDelay: false,
        allowWildcards: true,
        headers: {
            FOO: 'bar',
            BAZ: 'qux'
        }
      })

      server.addUSN('urn:Manufacturer:device:controllee:1')

      server.addUSN('urn:Manufacturer:device:controllee:1')

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      var socket = server._listener

      this.sinon.spy(server, '_respondToSearch')

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: urn:Manufacturer:device:*',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      socket.emit('message', MS_ALL, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(socket.send.calledOnce)

      var args = socket.send.getCall(0).args
        , message = args[0]
        , port = args[3]
        , ip = args[4]

      assert(Buffer.isBuffer(message))
      assert.equal(port, 2)
      assert.equal(ip, 1)

      var expectedMessage = [
        'HTTP/1.1 200 OK',
        'ST: urn:Manufacturer:device:*',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5::urn:Manufacturer:device:*',
        'LOCATION: http://' + localIp() + ':10293/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/' + process.versions.node + ' UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ', // note the space
        'FOO: bar',
        'BAZ: qux'
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(filteredMessage.sort(), expectedMessage.sort())

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })
  })
})
