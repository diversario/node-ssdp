var SSDP = require('./')
  , util = require('util')
  , assert = require('assert')

function SsdpServer(opts, sock) {
  this._subclass = 'ssdp-server'
  SSDP.call(this, opts, sock)
}

util.inherits(SsdpServer, SSDP)


/**
 * Binds UDP socket to an interface/port
 * and starts advertising.
 *
 * @param ipAddress
 */
SsdpServer.prototype.start = function (ipAddress, cb) {
  var self = this

  if (self._socketBound) {
    self._logger.warn('Server already running.')
    return
  }

  self._socketBound = true

  this._usns[this._udn] = this._udn

  if (typeof ipAddress === 'function') {
    cb = ipAddress;
    ipAddress = null;
  }
  var host = ipAddress || this._unicastHost;

  this._logger.trace('Will try to bind to ' + host + ':' + this._ssdpPort)

  self._start(this._ssdpPort, this._unicastHost, function () {
    self._initAdLoop();
    cb && cb();
  });
}


/**
 * Binds UDP socket
 *
 * @param ipAddress
 * @private
 */
SsdpServer.prototype._initAdLoop = function () {
  var self = this

  self._logger.info('UDP socket bound', {host: this._unicastHost, port: self._ssdpPort})

  self._startAdLoop()
}




/**
 * Advertise shutdown and close UDP socket.
 */
SsdpServer.prototype.stop = function (cb) {
  if (!this.sock) {
    this._logger.warn('Already stopped.')
    cb && cb();
    return
  }

  this.advertise(false)

  this._stopAdLoop()

  this._stop(cb)
}



SsdpServer.prototype._startAdLoop = function () {
  assert.equal(this._adLoopInterval, null, 'Attempting to start a parallel ad loop')

  // Run the first iteration immediately
  this.advertise();
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
      , nts = alive ? 'ssdp:alive' : 'ssdp:byebye' // notification sub-type

    var heads = {
      'HOST': self._ssdpServerHost,
      'NT': usn, // notification type, in this case same as ST
      'NTS': nts,
      'USN': udn
    }

    if (alive) {
      heads['LOCATION'] = self._location
      heads['CACHE-CONTROL'] = 'max-age=1800'
      heads['SERVER'] = self._ssdpSig // why not include this?
    }

    self._logger.trace('Sending ' + nts + ' advertisement')

    var message = self._getSSDPHeader('NOTIFY', heads)

    self._send(new Buffer(message), function (err, bytes) {
      self._logger.trace({'message': message}, 'Outgoing server message')
    })
  })
}

module.exports = SsdpServer
