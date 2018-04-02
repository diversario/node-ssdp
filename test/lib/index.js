require('../helper')

var assert = require('assert')

var SsdpBase = require('../../').Base

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
})