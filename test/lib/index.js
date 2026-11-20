require('../helper')

var assert = require('assert')

var SsdpBase = require('../../lib/index')

describe('Base class', function () {
  context('getMethod helper', function () {
    it('returns correct method, lowercased', function () {
      var ssdp = new SsdpBase

      var message = [
        'BLAH URI HTTP/1.1',
        'SOMETHING: or other',
        'AND more stuff',
        'maybe not even upper case'
      ].join('\r\n')

      var method = ssdp._getMethod(message)

      assert.equal(method, 'blah')
    })
  })

  context('getHeaders helper', function () {
    it('returns the headers, with names in upper case', function () {
      var ssdp = new SsdpBase

      var headers = ssdp._getHeaders([
        'NOTIFY * HTTP/1.1',
        'Host: 239.255.255.250:1900',
        'nt:upnp:rootdevice',
        'Location:   http://192.168.1.1:10293/upnp/desc.html',
        'EXT: ',
        'a line without a colon',
        ': a line without a name',
        '',
        ''
      ].join('\r\n'))

      assert.deepStrictEqual(headers, {
        'HOST': '239.255.255.250:1900',
        'NT': 'upnp:rootdevice',
        'LOCATION': 'http://192.168.1.1:10293/upnp/desc.html',
        'EXT': ''
      })
    })

    it('leaves out a line that has a line break inside', function () {
      var ssdp = new SsdpBase

      var headers = ssdp._getHeaders([
        'M-SEARCH * HTTP/1.1',
        'ST: one\nLOCATION: two',
        'MX: 3\rMAN: four',
        'HOST: 239.255.255.250:1900'
      ].join('\r\n'))

      assert.deepStrictEqual(headers, {'HOST': '239.255.255.250:1900'})
    })

    it('reads the largest message in a short time', function () {
      var ssdp = new SsdpBase

      // One UDP datagram holds 65,507 bytes at most. The pattern that read
      // the headers before needed about 2 seconds for this line.
      var line = 'A:' + ' '.repeat(32000) + 'x'.repeat(32000) + '\nx'

      var start = process.hrtime.bigint()

      ssdp._getHeaders('NOTIFY * HTTP/1.1\r\n' + line + '\r\n\r\n')

      var milliseconds = Number(process.hrtime.bigint() - start) / 1e6

      assert(milliseconds < 200, 'took ' + milliseconds + ' ms')
    })
  })
})