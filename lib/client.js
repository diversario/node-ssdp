var SSDP = require('./')
  , util = require('util')

function SsdpClient(opts, sock) {
  SSDP.call(this, opts, sock)
}



util.inherits(SsdpClient, SSDP)



SsdpClient.prototype.start = function (cb) {
  this._start()
  this.sock.bind(this._ssdpPort, this._unicastHost, cb)
}



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

  self._logger.trace('Sending an M-SEARCH request')

  var message = new Buffer(pkt)

  self.sock.send(message, 0, message.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
    self._logger.trace({'message': pkt}, 'Sent M-SEARCH request')
  })
}



module.exports = SsdpClient
