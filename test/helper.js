var sinon = require('sinon')
  , EE = require('events').EventEmitter
  , dgram = require('dgram')

beforeEach(function() {
  this.sinon = sinon.sandbox.create();
  this.sinon.stub(dgram, 'createSocket', getFakeSocket.bind(this))
});

afterEach(function(){
  this.sinon.restore();
});

function getFakeSocket() {
  var s = new EE

  s.type = 'udp4'

  s.address = this.sinon.stub()
  s.address.returns({
    address: 1,
    port: 2
  })

  s.addMembership = this.sinon.stub()
  s.setMulticastTTL = this.sinon.stub()
  s.setMulticastLoopback = this.sinon.stub()
  s.unref = this.sinon.stub()

  s.bind = function (/*port, addr, cb*/) {
    const cb = [].slice.call(arguments).pop()

    if (typeof cb == 'function') cb()
  }

  this.sinon.spy(s, 'bind')

  s.send = this.sinon.stub()
  s.close = this.sinon.stub()

  return s
}