require('../helper')

var assert = require('assert')

var Client = require('../../').Client

describe('Client', function () {
  context('when receiving a reply to M-SEARCH', function () {
    it('emit a parsed object', function (done) {
      var client = new Client(null, this.getFakeSocket())

      var response = [
        'HTTP/1.1 200 OK',
        'ST: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'USN: uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
        'LOCATION: http://0.0.0.0:10000/upnp/desc.html',
        'CACHE-CONTROL: max-age=1800',
        'DATE: Fri, 30 May 2014 15:07:26 GMT',
        'SERVER: node.js/0.10.28 UPnP/1.1 node-ssdp/1.0.1',
        'EXT: ' // note the space
      ]

      client.on('response', function (code, headers, rinfo) {
        assert.equal(code, 200)

        var expected = {
          'ST': 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          'USN': 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5',
          'LOCATION': 'http://0.0.0.0:10000/upnp/desc.html',
          'CACHE-CONTROL': 'max-age=1800',
          //'DATE': 'Fri, 30 May 2014 15:07:26 GMT',
          'SERVER': 'node.js/0.10.28 UPnP/1.1 node-ssdp/1.0.1',
          'EXT': ''
        }

        var date = headers.DATE

        delete headers.DATE

        assert.deepEqual(expected, headers)
        assert(/\w+, \d+ \w+ \d+ [\d:]+ GMT/.test(date))

        done()
      })

      client.start()

      client.sock.emit('message', Buffer(response.join('\r\n')))
    })
  })
})