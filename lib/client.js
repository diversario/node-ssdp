var SSDP = require('./')
  , util = require('util')

function SsdpClient(opts) {
  SSDP.call(this, opts)
}

util.inherits(SsdpClient, SSDP)

SsdpClient.prototype.search = function search(st) {
  var self = this

  require('dns').lookup(require('os').hostname(), function (err, add) {/* jshint unused: false */
    var pkt = self.getSSDPHeader(
      'M-SEARCH',
      {
        'HOST': self._ipPort,
        'ST': st,
        'MAN': '"ssdp:discover"',
        'MX': 3
      }
    )

    self._logger.trace('Sending an M-SEARCH request')

    var message = new Buffer(pkt)

    if (!self.sock) self._start()

    self.sock.send(message, 0, message.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
      self._logger.trace({'message': pkt}, 'Sent M-SEARCH request')
    })
  })
}

module.exports = SsdpClient
