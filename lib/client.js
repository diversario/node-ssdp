var SSDP = require('./')
var Buffer = require('buffer/').Buffer

/**
*
* @param opts
* @param [sock]
* @constructor
*/
class SsdpClient extends SSDP {
  constructor (opts, sock) {
    super()
    this._subclass = 'node-ssdp:client'
    SSDP.call(this, opts, sock)
  }
}

/**
*
* @param [cb]
*/
SsdpClient.prototype.start = function (cb) {
  this._start(0, this._unicastHost, cb)
}

/**
*Close UDP socket.
*/
SsdpClient.prototype.stop = function () {
  if (!this.sock) {
    this._logger('Already stopped.')
    return
  }

  this._stop()
}

/**
*
* @param {String} serviceType
* @returns {*}
*/
SsdpClient.prototype.search = function search(serviceType) {
  var self = this

  if (!this._started) {
    return this.start(function () {
      self.search(serviceType)
    })
  }

  var pkt = self._getSSDPHeader(
    'M-SEARCH',
    {
      'HOST': self._ssdpServerHost,
      'ST': serviceType,
      'MAN': '"ssdp:discover"',
      'MX': 3
    }
  )

  self._logger('Sending an M-SEARCH request')

  var message = new Buffer(pkt)

  self._send(message, function (err, bytes) {
    self._logger('Sent M-SEARCH request: %o', {'message': pkt})
  })
}

module.exports = SsdpClient
