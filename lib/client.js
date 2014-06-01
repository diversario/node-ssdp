var SSDP = require('./')
  , util = require('util')

function SsdpClient(opts) {
  SSDP.call(this, opts)
}

util.inherits(SsdpClient, SSDP)

SsdpClient.prototype.search = function search(serviceType) {
  var self = this

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

  if (!self.sock) self._start(self._createSocket())

  self.sock.send(message, 0, message.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
    self._logger.trace({'message': pkt}, 'Sent M-SEARCH request')
  })
}

module.exports = SsdpClient
