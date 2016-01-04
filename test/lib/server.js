require('../helper')

var assert = require('chai').assert

var moduleVersion = require('../../package.json').version
var Server = require('../../').Server

describe('Server', function () {
  context('on start', function () {
    it('binds appropriate listeners to socket', function () {
      var socket = this.getFakeSocket()

      var server = new Server(socket)

      server.start()

      var errorHandlers = socket.listeners('error')

      assert.equal(errorHandlers.length, 1)
      assert.equal(errorHandlers[0].name, 'onSocketError')

      var messageHandlers = socket.listeners('message')

      assert.equal(messageHandlers.length, 1)
      assert.equal(messageHandlers[0].name, 'onSocketMessage')

      var listeningHandlers = socket.listeners('listening')

      assert.equal(listeningHandlers.length, 1)
      assert.equal(listeningHandlers[0].name, 'onSocketListening')
    })

    it('does not allow double-binding on the socket', function () {
      var socket = this.getFakeSocket()
      var server = new Server(socket)

      this.sinon.spy(socket, 'on')

      server.start()
      server.start()
      server.start()

      assert.equal(socket.on.callCount, 3)
    })

    it('adds multicast membership', function (done) {
      var socket = this.getFakeSocket()
      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!'}, socket)

      server.start()

      socket.emit('listening')

      assert.equal(socket.addMembership.callCount, 1)
      assert(socket.addMembership.calledWith('fake ip'))

      assert.equal(socket.setMulticastTTL.callCount, 1)
      assert(socket.setMulticastTTL.calledWith('never!'))

      done()
    })

    it('starts advertising every n milliseconds', function (done) {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers
      var socket = this.getFakeSocket()
      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!', 'adInterval': adInterval}, socket)

      server.addUSN('tv/video')

      server.start(function () {
        clock.tick(300);

        // After 300 milliseconds, we should have received
        // two advertisements, because an additional USN
        // was added above.
        assert.equal(server.sock.send.callCount, 2);

        clock.tick(300);

        // After 600 milliseconds, we should have received
        // four advertisements.
        assert.equal(server.sock.send.callCount, 4);

        done();
      });
    })
  })

  context('on stop', function () {
    it('does not allow multiple _stops', function () {
      var socket = this.getFakeSocket()
      var server = new Server(socket)

      server.start()

      assert(server.sock.bind.calledOnce)

      server.stop()
      server.stop()
      server.stop()

      assert(!server.sock)
      assert.equal(socket.close.callCount, 1)
    })

    it('allows stopping after starting', function (done) {
      var server = new Server();
      server.start(function () {
        server.stop(function () {
          assert.equal(server._started, false);
          done();
        });
      });
    });

    it('allow starting after has been stopped', function (done) {
      var server = new Server();
      server.start(function () {
        server.stop(function () {
          server.start(function () {
            assert.equal(server._started, true);
            done();
          });
        });
      });
    });
  })

  context('when advertising', function () {
    it('sends out correct alive info', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers

      var socket = this.getFakeSocket()
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
      }, socket)

      var _advertise = server.advertise

      this.sinon.stub(server, 'advertise', function (alive) {
        if (alive === false) return
        _advertise.call(server)
      })

      server.addUSN('tv/video')

      server.start()

      // tick 900 milliseconds, which is less than 2 times the
      // adInterval (500) and thus the advertisement should have
      // been done twice (first time the initial and second after
      // adInterval has passed)
      clock.tick(900)
      // server.sock.send should've been called 4 times (with 2 unique args)
      assert.equal(server.sock.send.callCount, 4)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = server.sock.send.getCall(0).args

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

      var args2 = server.sock.send.getCall(1).args

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

    it('sends out correct byebye info', function () {
      var adInterval = 500 // to avoid all other advertise timers

      var socket = this.getFakeSocket()
      var server = new Server({
        ssdpIp: 'ip',
        ssdpTtl: 'never',
        adInterval: adInterval,
        ssdpSig: 'signature',
        unicastHost: 'unicast',
        location: 'location header',
        ttl: 'ttl',
        description: 'desc',
        udn: 'device name'
      }, socket)

      // avoid calling server.start

      server._adLoopInterval = 1

      server.addUSN('tv/video')

      server.stop()

      // server.sock.send should've been called once with
      // the byebye message
      assert.equal(socket.send.callCount, 1)

      // argument order is:
      // message, _, message.length, ssdp port, ssdp host
      var args1 = socket.send.getCall(0).args

      var method1 = server._getMethod(args1[0].toString())
      assert(method1, 'NOTIFY')

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
      var server = new Server(this.getFakeSocket())

      server.start()

      this.sinon.spy(server, 'emit')

      server._logger.warn = function (data, message) {
        if (message !== 'Unhandled command') return

        assert.equal(data.rinfo.address, 1)
        assert.equal(data.rinfo.port, 2)

        assert(server.emit.notCalled)

        done()
      }

      server.sock.emit('message', UNKNOWN_CMD, {address: 1, port: 2})
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
      var server = new Server(this.getFakeSocket())

      server.on('advertise-alive', function (headers) {
        ['HOST', 'NT', 'NTS', 'USN', 'LOCATION', 'CACHE-CONTROL', 'SERVER'].forEach(function (header) {
          assert(headers[header])
        })

        done()
      })

      server.start()

      server.sock.emit('message', NOTIFY_ALIVE, {address: 1, port: 2})
    })

    it('with ssdp:bye server emits `advertise-bye` with data', function (done) {
      var server = new Server(this.getFakeSocket())

      server.on('advertise-bye', function (headers) {
        ['HOST', 'NT', 'NTS', 'USN'].forEach(function (header) {
          assert(headers[header])
        })

        done()
      })

      server.start()

      server.sock.emit('message', NOTIFY_BYE, {address: 1, port: 2})
    })

    it('with unknown NTS server emits nothing but logs it', function (done) {
      var server = new Server(this.getFakeSocket())

      server.start()

      this.sinon.spy(server, 'emit')

      server._logger.trace = function (data, message) {
        if (message !== 'Unhandled NOTIFY event') return

        assert.equal(data.rinfo.address, 1)
        assert.equal(data.rinfo.port, 2)

        assert(server.emit.notCalled)

        done()
      }

      server.sock.emit('message', NOTIFY_WTF, {address: 1, port: 2})
    })
  })

  context('when receiving an M-SEARCH message', function () {
    it('with unknown service type it\'s ignored', function (done) {
      var server = new Server(this.getFakeSocket())

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      this.sinon.spy(server, '_respondToSearch')

      var MS_UNKNOWN = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: toaster',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      server.sock.emit('message', MS_UNKNOWN, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(server.sock.send.notCalled)

      done()
    })

    it('with ssdp:all service type it replies with a unicast 200 OK', function (done) {
      var server = new Server(this.getFakeSocket())

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      this.sinon.spy(server, '_respondToSearch')

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: ssdp:all',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      server.sock.emit('message', MS_ALL, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(server.sock.send.calledOnce)

      var args = server.sock.send.getCall(0).args
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
        'LOCATION: http://' + require('ip').address() + ':10293/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/' + process.versions.node + ' UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(filteredMessage, expectedMessage)

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })

    it('with matching wildcard it replies with a unicast 200 OK', function (done) {
      var server = new Server({
        allowWildcards: true
      }, this.getFakeSocket())
      server.addUSN('urn:Manufacturer:device:controllee:1')

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start()

      this.sinon.spy(server, '_respondToSearch')

      var MS_ALL = [
        'M-SEARCH * HTTP/1.1',
        'HOST: 239.255.255.250:1900',
        'ST: urn:Manufacturer:device:*',
        'MAN: "ssdp:discover"',
        'MX: 3'
      ].join('\r\n')

      server.sock.emit('message', MS_ALL, {address: 1, port: 2})

      assert(server._respondToSearch.calledOnce)
      assert(server.sock.send.calledOnce)

      var args = server.sock.send.getCall(0).args
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
        'LOCATION: http://' + require('ip').address() + ':10293/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/' + process.versions.node + ' UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(filteredMessage, expectedMessage)

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })
  })
})
