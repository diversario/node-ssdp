var SSDP = require('./')
  , util = require('util')
  , ip = require('ip')
  , assert = require('assert')

function SsdpServer(opts) {
  SSDP.call(this, opts)
}

util.inherits(SsdpServer, SSDP)


/**
 * Binds UDP socket to an interface/port
 * and starts advertising.
 *
 * @param ipAddress
 * @param [portno] Port number
 * @param [socket] UDP socket
 */

//FIXME: #18
SsdpServer.prototype.start = function (ipAddress, portno, socket) {
  var self = this

  if (self._socketBound) {
    self._logger.warn('Server already running.')
    return;
  }

  if (arguments.length !== 3) {
    // (socket)
    if (typeof ipAddress == 'object') {
      socket = ipAddress
      ipAddress = portno = undefined
    }
  }

  self._socketBound = true;

  if (!portno) portno = 10293

  this._usns[this._udn] = this._udn

  if (!ipAddress) {
    ipAddress = ip.address()
  }

  self._httphost = 'http://' + ipAddress + ':' + portno

  this._logger.trace('Will try to bind to ' + ipAddress + ':' + this._ssdpPort)

  if (self.sock) {
    this._bind(ipAddress)
  } else {
    self._start(socket || self._createSocket())
    this._bind(ipAddress)
  }
}



/**
 * Binds UDP socket
 *
 * @param ipAddress
 * @private
 */
SsdpServer.prototype._bind = function (ipAddress) {
  var self = this

  self.sock.bind(self._ssdpPort, ipAddress, function () {
    self._logger.info('UDP socket bound to ' + ipAddress + ':' + self._ssdpPort)

    // FIXME: what's the point in advertising we're dead
    // if the cache is going to be busted anyway?
    self.advertise(false)

    setTimeout(function () {
      self.advertise(false)
    }, 1000)

    // Wake up.
    setTimeout(self.advertise.bind(self), 2000)
    setTimeout(self.advertise.bind(self), 3000)

    self._startAdLoop()
  })
}



/**
 * Advertise shutdown and close UDP socket.
 */
SsdpServer.prototype.stop = function () {
  if (!this.sock) {
    this._logger.warn('Already stopped.')
    return;
  }

  this.advertise(false)
  this.advertise(false)

  this._stopAdLoop()

  this._stop()
}



SsdpServer.prototype._startAdLoop = function () {
  assert.equal(this._adLoopInterval, null, 'Attempting to start a parallel ad loop')

  this._adLoopInterval = setInterval(this.advertise.bind(this), this._adInterval)
}



SsdpServer.prototype._stopAdLoop = function () {
  assert.notEqual(this._adLoopInterval, null, 'Attempting to clear a non-existing interval')

  clearInterval(this._adLoopInterval)
  this._adLoopInterval = null
}



/**
 *
 * @param alive
 */
SsdpServer.prototype.advertise = function (alive) {
  var self = this

  if (!this.sock) return
  if (alive === undefined) alive = true

  Object.keys(self._usns).forEach(function (usn) {
    var udn = self._usns[usn]

    var heads = {
      'HOST': self._ssdpServerHost,
      'NT': usn, // notification type, in this case same as ST
      'NTS': (alive ? 'ssdp:alive' : 'ssdp:byebye'), // notification sub-type
      'USN': udn
    }

    if (alive) {
      heads['LOCATION'] = self._httphost + '/' + self._description
      heads['CACHE-CONTROL'] = 'max-age=1800'
      heads['SERVER'] = self._ssdpSig // why not include this?
    }

    self._logger.trace('Sending an advertisement event')

    var message = new Buffer(self._getSSDPHeader('NOTIFY', heads))

    self.sock.send(message, 0, message.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
      self._logger.trace({'message': message.toString()}, 'Outgoing server message')
    })
  })
}

module.exports = SsdpServer
