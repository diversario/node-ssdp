var SSDP = require('./')
  , util = require('util')
  , ip = require('ip')

function SsdpServer(opts) {
  SSDP.call(this, opts)
}

util.inherits(SsdpServer, SSDP)


/**
 * Binds UDP socket to an interface/port
 * and starts advertising.
 *
 * @param ipAddress
 * @param [portno]
 */
SsdpServer.prototype.start = function (ipAddress, portno) {
  var self = this

  if (self._socketBound) {
    self._logger.warn('Server already running.')
    return;
  }

  self._socketBound = true;

  if (!portno) portno = '10293'

  this._usns[this._udn] = this._udn

  if (!ipAddress) {
    var _ip = ip.address()
    self._httphost = 'http://' + _ip + ':' + portno
  } else {
    self._httphost = 'http://' + ipAddress + ':' + portno
  }

  this._logger.trace('Will try to bind to ' + (_ip || ipAddress) + ':' + this._ssdpPort)

  if (self.sock) {
    bind()
  } else {
    self._start()
    bind()
  }

  function bind() {
    self.sock.bind(self._ssdpPort, ipAddress, function () {
      self._logger.info('UDP socket bound to ' + ipAddress + ':' + self._ssdpPort)

      self.advertise(false)

      setTimeout(function () {
        self.advertise(false)
      }, 1000)

      // Wake up.
      setTimeout(self.advertise.bind(self), 2000)
      setTimeout(self.advertise.bind(self), 3000)

      // Ad loop.
      setInterval(self.advertise.bind(self), 10000)
    })
  }
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

  SSDP.prototype.stop.call(this)
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
      'HOST': self._ipPort,
      'NT': usn,
      'NTS': (alive ? 'ssdp:alive' : 'ssdp:byebye'),
      'USN': udn
    }

    if (alive) {
      heads['LOCATION'] = self._httphost + '/' + self._description
      heads['CACHE-CONTROL'] = 'max-age=1800'
      heads['SERVER'] = self._ssdpSig
    }

    self._logger.trace('Sending an advertisement event')

    var out = new Buffer(self.getSSDPHeader('NOTIFY', heads))

    self.sock.send(out, 0, out.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
      self._logger.trace({'message': out.toString()}, 'Outgoing server message')
    })
  })
}

module.exports = SsdpServer
