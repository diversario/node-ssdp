var sinon = require('sinon')
  , EE = require('events').EventEmitter
  , dgram = require('dgram')

beforeEach(function() {
  this.sinon = sinon.createSandbox();
  this.sinon.stub(dgram, 'createSocket').callsFake(getFakeSocket.bind(this))
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
    var cb = [].slice.call(arguments).pop()

    if (typeof cb == 'function') cb()
  }

  this.sinon.spy(s, 'bind')

  // Like a real socket, it reports that the message is sent a moment later.
  s.send = this.sinon.stub().callsFake(function () {
    var cb = [].slice.call(arguments).pop()

    s.emit('_send_called')

    if (typeof cb == 'function') process.nextTick(cb)
  })

  s.close = this.sinon.stub()

  return s
}