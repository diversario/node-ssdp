var Header = require('../lib/ssdpHeader')
var expect = require('chai').expect

describe('SSDP Header class', function () {
  context('constructor', function () {
    it('sets method, headers and isResponse')
    it('throws when method is not given')
    it('generates random ID')
  })

  context('#id', function () {
    it('returns ID')
  })

  context('#setHeader', function () {
    it('sets header')
    it('does not set header when called with != 2 arguments')
    it('overwrites existing header')
  })

  context('#setHeaders', function () {
    it('sets headers')
    it('does not set header when called with non-object')
    it('overwrites existing headers')
  })

  context('#isResponse', function () {
    it('returns isResponse')
  })

  context('#overrideLocationOnSend', function () {
    it('sets overrideLocationOnSend to true')
  })

  context('#isOverrideLocationOnSend', function () {
    it('returns overrideLocationOnSend')
  })

  context('#toString', function () {
    it('returns a string')
    it('accepts override headers')
  })

  context('#toBuffer', function () {
    it('returns a buffer')
    it('accepts override headers')
  })
})