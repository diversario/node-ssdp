require('../helper')
var moduleVersion = require('../../package.json').version

var expect = require('chai').expect
var assert = require('assert')

var Client = require('../../').Client

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

      client.on('response', function (headers, code, rinfo) {
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

      client.sockets[iface].emit('message', Buffer(response.join('\r\n')))
    })
  })
})
