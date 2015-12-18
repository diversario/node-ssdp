var SSDP = require('./')
  , util = require('util')
  , c = require('./const')


/**
 *
 * @param opts
 * @constructor
 */
function SsdpClient(opts) {
  this._subclass = 'ssdp-client'
  SSDP.call(this, opts)
}



util.inherits(SsdpClient, SSDP)


/**
 *
 * @param [cb]
 */
SsdpClient.prototype.start = function (cb) {
  this._start(cb)
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
    c.M_SEARCH,
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
