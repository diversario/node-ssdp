'use strict'

var dgram = require('react-native-udp')
, EE = require('events').EventEmitter
, ip = require('ip')
, debug = require('debug')

var httpHeader = /HTTP\/\d{1}\.\d{1} \d+ .*/
, ssdpHeader = /^([^:]+):\s*(.*)$/

var nodeVersion = '6.0.0'
, moduleVersion = require('../package.json').version
, moduleName = require('../package.json').name

var NetworkInfo = require('react-native-network-info')

var Buffer  = require('buffer/')
/**
* Options:
*
* @param {Object} opts
* @param {String} opts.ssdpSig SSDP signature
* @param {String} opts.ssdpIp SSDP multicast group
* @param {String} opts.ssdpPort SSDP port
* @param {Number} opts.ssdpTtl Multicast TTL
* @param {Number} opts.adInterval Interval at which to send out advertisement (ms)
* @param {String} opts.description Path to SSDP description file
* @param {String} opts.udn SSDP Unique Device Name
*
* @param {Number} opts.ttl Packet TTL
* @param {Boolean} opts.allowWildcards Allow wildcards in M-SEARCH packets (non-standard)
*
* @returns {SSDP}
* @constructor
*/
class SSDP extends EE {
  constructor (opts, sock) {
    super()

    if (!(this instanceof SSDP)) return new SSDP(opts)

    this._subclass = this._subclass || 'ssdp-base'

    // we didn't get options, only socket
    if (!sock) {
      if (opts && /^udp\d$/.test(opts.type) && typeof opts.addMembership == 'function') {
        sock = opts
        opts = null
      }
    }

    opts = opts || {}

    if (sock) {
      this.sock = sock
    } else {
      this.sock = dgram.createSocket('udp4')
      this.sock.unref()
    }
    this._init(opts)
  }
}

//util.inherits(SSDP, EE)

/**
 * Initializes instance properties.
 * @param opts
 * @private
 */
SSDP.prototype._init = function (opts) {
  this._logger = debug(this._subclass)

  this._ssdpSig = opts.ssdpSig || getSsdpSignature()

  // User shouldn't need to set these
  this._ssdpIp = opts.ssdpIp || '239.255.255.250'
  this._ssdpPort = opts.ssdpPort || 1900
  this._ssdpTtl = opts.ssdpTtl || 1

  this._adInterval = opts.adInterval || 10000

  this._ttl = opts.ttl || 1800

  if (typeof opts.location === 'function') {
    Object.defineProperty(this, '_location', {
      enumerable: true,
      get: opts.location
    })
  } else {
    // Probably should specify these
    this._location = opts.location || 'http://' + NetworkInfo.getIPAddress(ip => { return ip })/*ip.address()*/ + ':' + 10293 + '/upnp/desc.html'
  }

  this._unicastHost = opts.unicastHost || '0.0.0.0'
  this._unicastBindPort = opts.unicastBindPort || 0
  this._ssdpServerHost = this._ssdpIp + ':' + this._ssdpPort

  this._usns = {}
  this._udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'

  this._allowWildcards = opts.allowWildcards
}

/**
 * Advertise shutdown and close UDP socket.
 */
SSDP.prototype._stop = function () {
  if (!this.sock) {
    this._logger('Already stopped.')
    return
  }

  this.sock.close()
  this.sock = null

  this._socketBound = this._started = false
}


/**
 * Configures UDP socket `socket`.
 * Binds event listeners.
 */
SSDP.prototype._start = function (port, host, cb) {
  var self = this

  if (self._started) {
    self._logger('Already started.')
    return
  }

  self._started = true

  this.sock.addListener('error', function onSocketError (err) {
    self._logger('Socker error: %s', err.message)
  })

  this.sock.addListener('message', function onSocketMessage (msg, rinfo) {
    self._parseMessage(msg, rinfo)
  })

  this.sock.addListener('listening', function onSocketListening () {
    var addr = self.sock.address()

    self._logger('SSDP listening: %o', {address: 'http://' + addr.address + ':' + addr.port})

    addMembership()

    function addMembership () {
      try {
        self.sock.addMembership(self._ssdpIp)
        self.sock.setMulticastTTL(self._ssdpTtl)
      } catch (e) {
        if (e.code === 'ENODEV' || e.code === 'EADDRNOTAVAIL') {
          self._logger('No interface present to add multicast group membership. Scheduling a retry. %s', e.message)
          setTimeout(addMembership, 5000)
        } else {
          throw e
        }
      }
    }
  })

  this.sock.bind(port, host, cb)
}

/**
 * Routes a network message to the appropriate handler.
 *
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseMessage = function (msg, rinfo) {
  msg = msg.toString()

  //this._logger('Multicast message: %o', {message: msg})

  var type = msg.split('\r\n').shift()

  // HTTP/#.# ### Response to M-SEARCH
  if (httpHeader.test(type)) {
    this._parseResponse(msg, rinfo)
  } else {
    this._parseCommand(msg, rinfo)
  }
}


/**
 * Parses SSDP command.
 *
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseCommand = function parseCommand(msg, rinfo) {
  var method = this._getMethod(msg)
    , headers = this._getHeaders(msg)

  switch (method) {
    case 'NOTIFY':
      this._notify(headers, msg, rinfo)
      break
    case 'M-SEARCH':
      this._msearch(headers, msg, rinfo)
      break
    default:
      this._logger('Unhandled command: %o', {'message': msg, 'rinfo': rinfo})
  }
}



/**
 * Handles NOTIFY command
 * Emits `advertise-alive`, `advertise-bye` events.
 *
 * @param headers
 * @param msg
 * @param rinfo
 */
SSDP.prototype._notify = function (headers, msg, rinfo) {
  if (!headers.NTS) {
    this._logger('Missing NTS header: %o', headers)
    return
  }

  switch (headers.NTS.toLowerCase()) {
    // Device coming to life.
    case 'ssdp:alive':
      this.emit('advertise-alive', headers, rinfo)
      break

    // Device shutting down.
    case 'ssdp:byebye':
      this.emit('advertise-bye', headers, rinfo)
      break

    default:
      this._logger('Unhandled NOTIFY event: %o', {'message': msg, 'rinfo': rinfo})
  }
}



/**
 * Handles M-SEARCH command.
 *
 * @param headers
 * @param msg
 * @param rinfo
 */
SSDP.prototype._msearch = function (headers, msg, rinfo) {
  this._logger('SSDP M-SEARCH event: %o', {'ST': headers.ST, 'address': rinfo.address, 'port': rinfo.port})

  if (!headers.MAN || !headers.MX || !headers.ST) return

  this._respondToSearch(headers.ST, rinfo)
}



/**
 * Sends out a response to M-SEARCH commands.
 *
 * @param {String} serviceType Service type requested by a client
 * @param {Object} rinfo Remote client's address
 * @private
 */
SSDP.prototype._respondToSearch = function (serviceType, rinfo) {
  var self = this
    , peer = rinfo.address
    , port = rinfo.port
    , stRegex
    , acceptor

  // unwrap quoted string
  if (serviceType[0] == '"' && serviceType[serviceType.length-1] == '"') {
    serviceType = serviceType.slice(1, -1)
  }

  if (self._allowWildcards) {
      stRegex = new RegExp(serviceType.replace(/\*/g, '.*') + '$')
      acceptor = function(usn, serviceType) {
          return serviceType === 'ssdp:all' || stRegex.test(usn)
      }
  } else {
      acceptor = function(usn, serviceType) {
          return serviceType === 'ssdp:all' || usn === serviceType
      }
  }

  Object.keys(self._usns).forEach(function (usn) {
    var udn = self._usns[usn]

    if (self._allowWildcards) {
        udn = udn.replace(stRegex, serviceType)
    }

    if (acceptor(usn, serviceType)) {
      var pkt = self._getSSDPHeader(
        '200 OK',
        {
          'ST': serviceType === 'ssdp:all' ? usn : serviceType,
          'USN': udn,
          'LOCATION': self._location,
          'CACHE-CONTROL': 'max-age=' + self._ttl,
          'DATE': new Date().toUTCString(),
          'SERVER': self._ssdpSig,
          'EXT': ''
        },
        true
      )

      self._logger('Sending a 200 OK for an M-SEARCH: %o', {'peer': peer, 'port': port})

      var message = new Buffer(pkt)

      self._send(message, peer, port, function (err, bytes) {
        self._logger('Sent M-SEARCH response: %o', {'message': pkt})
      })
    }
  })
}



/**
 * Parses SSDP response message.
 *
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseResponse = function parseResponse(msg, rinfo) {
  this._logger('SSDP response: %o', {'message': msg})

  var headers = this._getHeaders(msg)
    , statusCode = this._getStatusCode(msg)

  this.emit('response', headers, statusCode, rinfo)
}



SSDP.prototype.addUSN = function (device) {
  this._usns[device] = this._udn + '::' + device
}



SSDP.prototype._getSSDPHeader = function (method, headers, isResponse) {
  var message = []

  if (isResponse) {
    message.push('HTTP/1.1 ' + method)
  } else {
    message.push(method + ' * HTTP/1.1')
  }

  Object.keys(headers).forEach(function (header) {
    message.push(header + ': ' + headers[header])
  })

  message.push('\r\n')

  return message.join('\r\n')
}



SSDP.prototype._getMethod = function _getMethod(msg) {
  var lines = msg.split("\r\n")
    , type = lines.shift().split(' ')// command, such as "NOTIFY * HTTP/1.1"
    , method = type[0]

  return method
}



SSDP.prototype._getStatusCode = function _getStatusCode(msg) {
  var lines = msg.split("\r\n")
    , type = lines.shift().split(' ')// command, such as "NOTIFY * HTTP/1.1"
    , code = parseInt(type[1], 10)

  return code
}



SSDP.prototype._getHeaders = function _getHeaders(msg) {
  var lines = msg.split("\r\n")

  var headers = {}

  lines.forEach(function (line) {
    if (line.length) {
      var pairs = line.match(ssdpHeader)
      if (pairs) headers[pairs[1].toUpperCase()] = pairs[2] // e.g. {'HOST': 239.255.255.250:1900}
    }
  })

  return headers
}



SSDP.prototype._send = function (message, host, port, cb) {
  var self = this

  if (typeof host === 'function') {
    cb = host
    host = this._ssdpIp
    port = this._ssdpPort
  }

  self.sock.send(message, 0, message.length, port, host, cb)
}



function getSsdpSignature() {
  return 'node.js/' + nodeVersion + ' UPnP/1.1 ' + moduleName + '/' + moduleVersion
}



module.exports = SSDP
