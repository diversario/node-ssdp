var Header = require('../../lib/ssdpHeader')
var expect = require('chai').expect

describe('SSDP Header class', function () {
  context('constructor', function () {
    it('sets method, headers and isResponse', function () {
      var h = new Header('method', {foo: 'bar'}, true)

      expect(h._method).to.equal('method')
      expect(h._headers.foo).to.equal('bar')
      expect(h._isResponse).to.be.true
    })

    it('throws when method is not given', function () {
      try {
        new Header('method', {foo: 'bar'}, true)
      } catch (e) {
        expect(e.message).to.contain('header requires method')
      }
    })

    it('generates random ID', function () {
      var h1 = new Header('method')
      var h2 = new Header('method')

      expect(h1._id).to.exist
      expect(h2._id).to.exist
      expect(h1._id).to.not.equal(h2._id)
    })
  })

  context('#id', function () {
    it('returns ID', function () {
      expect(new Header('method').id()).to.exist
      expect(new Header('method').id()).to.be.a.string
    })
  })

  context('#setHeader', function () {
    it('sets header', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeader('foo', '1')
      h.setHeader('bar', '2')

      expect(h._headers).to.deep.equal({foo: '1', bar: '2'})
    })

    it('does not set header when called with != 2 arguments', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeader('foo')

      expect(h._headers).to.deep.equal({})
    })

    it('overwrites existing header', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeader('foo', 'bar')

      expect(h._headers).to.deep.equal({foo: 'bar'})

      h.setHeader('foo', 'not bar')

      expect(h._headers).to.deep.equal({foo: 'not bar'})
    })
  })

  context('#setHeaders', function () {
    it('sets headers', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeaders({
        foo: 1,
        bar: 2
      })

      expect(h._headers).to.deep.equal({foo: 1, bar: 2})
    })

    it('does not set header when called with non-object', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeaders()
      h.setHeaders([])
      h.setHeaders(/sdf/)
      h.setHeaders(function(){})
      h.setHeaders('zxc')
      h.setHeaders(123)

      expect(h._headers).to.deep.equal({})
    })

    it('overwrites existing headers', function () {
      var h = new Header('method')

      expect(h._headers).to.deep.equal({})

      h.setHeaders({
        foo: 1,
        bar: 2
      })

      expect(h._headers).to.deep.equal({foo: 1, bar: 2})

      h.setHeaders({
        foo: 13,
        bar: 14
      })

      expect(h._headers).to.deep.equal({foo: 13, bar: 14})
    })
  })

  context('#isResponse', function () {
    it('returns isResponse', function () {
      var h = new Header('method')
      expect(h.isResponse()).to.be.false

      h = new Header('method', {}, false)
      expect(h.isResponse()).to.be.false

      h = new Header('method', {}, true)
      expect(h.isResponse()).to.be.true
    })
  })

  context('#overrideLocationOnSend', function () {
    it('sets overrideLocationOnSend to true', function () {
      var h = new Header('method')
      expect(h._overrideLocationOnSend).to.be.not.ok

      h.overrideLocationOnSend()
      expect(h._overrideLocationOnSend).to.be.true
    })
  })

  context('#isOverrideLocationOnSend', function () {
    it('returns overrideLocationOnSend', function () {
      var h = new Header('method')
      expect(h.isOverrideLocationOnSend()).to.be.false

      h.overrideLocationOnSend()
      expect(h.isOverrideLocationOnSend()).to.be.true
    })
  })

  context('#toString', function () {
    it('returns a string', function () {
      var hRequest = new Header('method', {foo: 1, BAR: 'two'})

      var expectedRequestString = 'METHOD * HTTP/1.1\r\nfoo: 1\r\nBAR: two\r\n\r\n'
      expect(hRequest.toString()).to.equal(expectedRequestString)

      var hResponse = new Header('method', {foo: 1, BAR: 'two'}, true)

      var expectedResponseString = 'HTTP/1.1 METHOD\r\nfoo: 1\r\nBAR: two\r\n\r\n'
      expect(hResponse.toString()).to.equal(expectedResponseString)
    })

    it('accepts override headers', function () {
      var hRequest = new Header('method', {foo: 1, BAR: 'two'})

      var expectedRequestString = 'METHOD * HTTP/1.1\r\nfoo: 1\r\nBAR: three\r\nBoo: yes\r\n\r\n'
      expect(hRequest.toString({Boo: 'yes', BAR: 'three'})).to.equal(expectedRequestString)
    })
  })

  context('#toBuffer', function () {
    it('returns a buffer', function () {
      var hRequest = new Header('method', {foo: 1, BAR: 'two'})

      var expectedRequestBuffer = Buffer.from('METHOD * HTTP/1.1\r\nfoo: 1\r\nBAR: two\r\n\r\n')
      expect(hRequest.toBuffer()).to.deep.equal(expectedRequestBuffer)
    })

    it('accepts override headers', function () {
      var hRequest = new Header('method', {foo: 1, BAR: 'two'})

      var expectedRequestBuffer = Buffer.from('METHOD * HTTP/1.1\r\nfoo: 1\r\nBAR: three\r\nBoo: yes\r\n\r\n')
      expect(hRequest.toBuffer({Boo: 'yes', BAR: 'three'})).to.deep.equal(expectedRequestBuffer)
    })
  })
})