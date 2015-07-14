var SSDP = require('./')
  , util = require('util')


/**
 *
 * @param opts
 * @param [sock]
 * @constructor
 */
function SsdpClient(opts) {
  SSDP.call(this, opts, 'ssdp-client')
}



util.inherits(SsdpClient, SSDP)


/**
 *
 * @param [cb]
 */
SsdpClient.prototype.start = function (cb) {
  this._start(0, this._unicastHost, cb)
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

  self._logger.trace({'message': pkt}, 'Sending an M-SEARCH request')

  var message = new Buffer(pkt)

  self._send(message, 'Sent M-SEARCH request')
}



module.exports = SsdpClient
