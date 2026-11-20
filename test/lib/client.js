require('../helper')
var moduleVersion = require('../../package.json').version

var expect = require('chai').expect
var assert = require('assert')
var os = require('os')

var Client = require('../../lib/client')

describe('Client', function () {
  context('start', function() {
    var client;
    beforeEach(function() {
      client = new Client()
    })

    afterEach(function() {
      client.stop();
    })

    it('takes callback', function (done) {
      client.start(function() {
        assert(true);
        done();
      });
    });

    it('returs a promise', function (done) {
      client.start().then(function () {
        assert(true);
        done()
      });
    });

    it('gives the error of a failed start to the callback, and then the promise needs no handler', async function () {
      this.sinon.stub(os, 'networkInterfaces').returns({})

      var unhandled = this.sinon.stub()
        , started = this.sinon.stub()

      process.on('unhandledRejection', unhandled)

      try {
        client.start(started)

        // Node.js reports a rejected promise that has no handler after the
        // step in which it was rejected.
        await new Promise(function (resolve) { setImmediate(resolve) })
        await new Promise(function (resolve) { setImmediate(resolve) })

        assert(started.calledOnce)
        assert.match(started.getCall(0).args[0].message, /No sockets available/)
        assert(unhandled.notCalled)
      } finally {
        process.removeListener('unhandledRejection', unhandled)
      }
    });

    it('warns when a search cannot start the client, and sends nothing', async function () {
      this.sinon.stub(os, 'networkInterfaces').returns({})
      this.sinon.stub(process, 'emitWarning')

      var unhandled = this.sinon.stub()

      process.on('unhandledRejection', unhandled)

      try {
        client.search('ssdp:all')

        // Node.js reports a rejected promise that has no handler after the
        // step in which it was rejected.
        await new Promise(function (resolve) { setImmediate(resolve) })
        await new Promise(function (resolve) { setImmediate(resolve) })

        assert(!client.sockets)

        assert(process.emitWarning.calledOnce)
        assert.match(process.emitWarning.getCall(0).args[0], /The search is not sent.*No sockets available/)
        assert.equal(process.emitWarning.getCall(0).args[1].code, 'NODE_SSDP_START_FAILED')

        assert(unhandled.notCalled)
      } finally {
        process.removeListener('unhandledRejection', unhandled)
      }
    });
  });


  context('when receiving a reply to M-SEARCH', function () {
    var client;
    beforeEach(function() {
      client = new Client()
    })

    afterEach(function() {
      client.stop()
    })

    it('emit a parsed object', function (done) {
      var response = [
        'HTTP/1.1 200 OK',
        'ST: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'LOCATION: http://0.0.0.0:10000/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        'DATE: Fri, 30 May 2014 15:07:26 GMT',
        'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion,
        'EXT: ' // note the space
      ]

      client.on('response', function (headers, code) {
        expect(code).to.equal(200)

        var expected = {
          'ST': 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          'USN': 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          'LOCATION': 'http://0.0.0.0:10000/upnp/desc.html',
          'CACHE-CONTROL': 'max-age=1800',
          //'DATE': 'Fri, 30 May 2014 15:07:26 GMT',
          'SERVER': 'node.js/0.10.28 UPnP/1.1 node-ssdp/' + moduleVersion,
          'EXT': ''
        }

        var date = headers.DATE

        delete headers.DATE

        expect(expected).to.deep.equal(headers)
        expect(date).to.match(/\w+, \d+ \w+ \d+ [\d:]+ GMT/)

        done()
      })

      client.start()

      var iface = Object.keys(client.sockets)[0]

      client.sockets[iface].emit('message', Buffer.from(response.join('\r\n')))
    })
  })

  context('when a search cannot leave through an interface', function () {
    var client, socket

    // One entry of `os.networkInterfaces()`.
    function ipv4(address) {
      return {address: address, netmask: '255.255.255.0', family: 'IPv4', internal: false}
    }

    // Makes every later send of the socket end with this error, or work.
    function sendsEndWith(error) {
      socket.send.callsFake(function () {
        process.nextTick([].slice.call(arguments).pop(), error)
      })
    }

    function unreachable() {
      var error = new Error('send EHOSTUNREACH 239.255.255.250:1900')

      error.code = 'EHOSTUNREACH'

      return error
    }

    // Searches, and waits until every socket has reported its send.
    function search() {
      client.search('ssdp:all')

      return new Promise(function (resolve) { setImmediate(resolve) })
    }

    beforeEach(async function () {
      this.sinon.stub(os, 'networkInterfaces').returns({
        'en0': [ipv4('192.168.1.1')],
        'en1': [ipv4('10.0.0.1')]
      })

      this.sinon.stub(process, 'emitWarning')

      client = new Client()

      await client.start()

      socket = client.sockets['192.168.1.1']
    })

    afterEach(function () {
      client.stop()
    })

    it('warns once, and names the interface', async function () {
      sendsEndWith(unreachable())

      await search()
      await search()

      assert(process.emitWarning.calledOnce)
      assert.match(process.emitWarning.getCall(0).args[0], /en0 \(192\.168\.1\.1\).*EHOSTUNREACH/)
      assert.equal(process.emitWarning.getCall(0).args[1].code, 'NODE_SSDP_SEND_FAILED')
    })

    it('warns again when the sends fail after one has worked', async function () {
      sendsEndWith(unreachable())
      await search()

      sendsEndWith(undefined)
      await search()

      sendsEndWith(unreachable())
      await search()

      assert(process.emitWarning.calledTwice)
    })
  })
})
