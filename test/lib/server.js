require('../helper')

var assert = require('assert')

var Server = require('../../').Server

describe('Server', function () {
  context('on start', function () {
    it('binds appropriate listeners to socket', function () {
      var server = new Server

      var socket = this.getFakeSocket()

      server.start(socket)

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
      var server = new Server

      var socket = this.getFakeSocket()

      this.sinon.spy(socket, 'on')

      server.start(socket)
      server.start(socket)
      server.start(socket)

      assert.equal(socket.on.callCount, 3)
    })

    it('adds multicast membership', function (done) {
      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!'})

      var socket = this.getFakeSocket()

      server.start(socket)

      socket.emit('listening')

      assert.equal(socket.addMembership.callCount, 1)
      assert(socket.addMembership.calledWith('fake ip'))

      assert.equal(socket.setMulticastTTL.callCount, 1)
      assert(socket.setMulticastTTL.calledWith('never!'))

      done()
    })

    it('starts advertising every n milliseconds', function () {
      var clock = this.sinon.useFakeTimers()
      var adInterval = 500 // to avoid all other advertise timers
      var server = new Server({ssdpIp: 'fake ip', ssdpTtl: 'never!', 'adInterval': adInterval})
      var socket = this.getFakeSocket()

      server.addUSN('tv/video')

      server.start(socket)

      clock.tick(500)

      // it's 4 because we call `advertise` immediately after bind. Lame.
      assert.equal(server.sock.send.callCount, 4)
    })
  })

  context('on stop', function () {
    it('does not allow multiple _stops', function () {
      var server = new Server

      var sockStub = this.getFakeSocket()
      server.start(sockStub)

      assert(server.sock.bind.calledOnce)

      server.stop()
      server.stop()
      server.stop()

      assert(!server.sock)
      assert.equal(sockStub.close.callCount, 1)
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
      'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/1.0.1'
    ].join('\r\n')

    it('server emits nothing but logs it', function (done) {
      var server = new Server

      server.start(this.getFakeSocket())

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
      'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/1.0.1'
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

      server.start(this.getFakeSocket())

      server.sock.emit('message', NOTIFY_ALIVE, {address: 1, port: 2})
    })

    it('with ssdp:bye server emits `advertise-bye` with data', function (done) {
      var server = new Server

      server.on('advertise-bye', function (headers) {
        ['HOST', 'NT', 'NTS', 'USN'].forEach(function (header) {
          assert(headers[header])
        })

        done()
      })

      server.start(this.getFakeSocket())

      server.sock.emit('message', NOTIFY_BYE, {address: 1, port: 2})
    })

    it('with unknown NTS server emits nothing but logs it', function (done) {
      var server = new Server

      server.start(this.getFakeSocket())

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
      var server = new Server

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start(this.getFakeSocket())

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
      var server = new Server

      server.advertise = this.sinon.stub() // otherwise it'll call `send`

      server.start('0.0.0.0', 10000, this.getFakeSocket())

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
        'LOCATION: http://0.0.0.0:10000/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        //'DATE: Fri, 30 May 2014 15:07:26 GMT', we'll test for this separately
        'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/1.0.1',
        'EXT: ' // note the space
      ]

      message = message.toString().split('\r\n')

      var filteredMessage = message.filter(function (header) {
        return !/^DATE/.test(header) && header !== ''
      })

      assert.deepEqual(expectedMessage, filteredMessage)

      var dateHeader = message.filter(function (header) {
        return /^DATE/.test(header)
      })[0]

      // should look like UTC string
      assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(dateHeader))

      done()
    })
  })
})