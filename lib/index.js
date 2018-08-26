'use strict'

/*
 MIT License

 Copyright (c) 2016 Ilya Shaisultanov

 Permission is hereby granted, free of charge, to any person obtaining a copy
 of this software and associated documentation files (the "Software"), to deal
 in the Software without restriction, including without limitation the rights
 to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the Software is
 furnished to do so, subject to the following conditions:

 The above copyright notice and this permission notice shall be included in all
 copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 SOFTWARE.
 */

var dgram = require('dgram')
  , EE = require('events').EventEmitter
  , util = require('util')
  , ip = require('ip')
  , debug = require('debug')
  , os = require('os')
  , async = require('async')
  , extend = require('extend')
  , SsdpHeader = require('./ssdpHeader')

var httpHeader = /HTTP\/\d{1}\.\d{1} \d+ .*/
  , ssdpHeader = /^([^:]+):\s*(.*)$/

/* consts */
var c = require('./const')

var nodeVersion = process.version.substr(1)
  , moduleVersion = require('../package.json').version
  , moduleName = require('../package.json').name



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
 * @param {Object} opts.headers Additional headers
 * @param {Array} opts.interfaces Names of interfaces to use. When set, other interfaces are ignored.
 *
 * @param {Number} opts.ttl Packet TTL
 * @param {Boolean} opts.allowWildcards Allow wildcards in M-SEARCH packets (non-standard)
 *
 * @returns {SSDP}
 * @constructor
 */
function SSDP(opts) {
  var self = this

  if (!(this instanceof SSDP)) return new SSDP(opts)

  this._subclass = this._subclass || 'node-ssdp:base'

  opts = opts || {}

  this._logger = opts.customLogger || debug(this._subclass)

  EE.call(self)

  this._init(opts)
}


util.inherits(SSDP, EE)


/**
 * Initializes instance properties.
 * @param opts
 * @private
 */
SSDP.prototype._init = function (opts) {
  this._ssdpSig = opts.ssdpSig || getSsdpSignature()

  this._explicitSocketBind = opts.explicitSocketBind
  this._interfaces = opts.interfaces
  this._reuseAddr = opts.reuseAddr === undefined ? true : opts.reuseAddr

  // User shouldn't need to set these
  this._ssdpIp = opts.ssdpIp || c.SSDP_DEFAULT_IP
  this._ssdpPort = opts.ssdpPort || c.SSDP_DEFAULT_PORT
  this._ssdpTtl = opts.ssdpTtl || 4

  // port on which to listen for messages
  // this generally should be left up to the system for SSDP Client
  // For server, this will be set by the server constructor
  // unless user sets a value.
  this._sourcePort = opts.sourcePort || 0

  this._adInterval = opts.adInterval || 10000

  this._ttl = opts.ttl || 1800

  if (typeof opts.location === 'function') {
    Object.defineProperty(this, '_location', {
      enumerable: true,
      get: opts.location
    })
  } else if (typeof opts.location === 'object') {
    this._locationProtocol = opts.location.protocol || 'http://'
    this._locationPort = opts.location.port
    this._locationPath = opts.location.path
  } else {
    // Probably should specify this explicitly
    this._location = opts.location || 'http://' + ip.address() + ':' + 10293 + '/upnp/desc.html'
  }

  this._ssdpServerHost = this._ssdpIp + ':' + this._ssdpPort

  this._usns = {}
  this._udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'

  this._extraHeaders = opts.headers || {}

  this._allowWildcards = opts.allowWildcards

  this._suppressRootDeviceAdvertisements = opts.suppressRootDeviceAdvertisements
}



/**
 * Creates and returns UDP4 socket.
 * Prior to node v0.12.x `dgram.createSocket` did not accept
 * an object and socket reuse was not available; this method
 * contains a crappy workaround to make version of node before 0.12
 * to work correctly. See https://github.com/diversario/node-ssdp/pull/38
 *
 * @returns {Socket}
 * @private
 */
SSDP.prototype._createSockets = function () {
  var interfaces = os.networkInterfaces()
    , self = this

  this.sockets = {}

  Object.keys(interfaces).forEach(function (iName) {
    if (!self._interfaces || self._interfaces.indexOf(iName) > -1) {
      self._logger('discovering all IPs from interface %s', iName)

      interfaces[iName].forEach(function (ipInfo) {
        if (ipInfo.internal == false && ipInfo.family == "IPv4") {
          self._logger('Will use interface %s', iName)
          var socket

          if (parseFloat(process.version.replace(/\w/, '')) >= 0.12) {
            socket = dgram.createSocket({type: 'udp4', reuseAddr: self._reuseAddr})
          } else {
            socket = dgram.createSocket('udp4')
          }

          if (socket) {
            socket.unref()

            self.sockets[ipInfo.address] = socket
          }
        }
      })
    }
  })

  if (Object.keys(this.sockets) == 0) {
    throw new Error('No sockets available, cannot start.')
  }
}


/**
 * Advertise shutdown and close UDP socket.
 */
SSDP.prototype._stop = function () {
  var self = this

  if (!this.sockets) {
    this._logger('Already stopped.')
    return
  }

  Object.keys(this.sockets).forEach(function (ipAddress) {
    var socket = self.sockets[ipAddress]

    socket && socket.close()

    self._logger('Stopped socket on %s', ipAddress)
  })

  this.sockets = null

  this._socketBound = this._started = false
}


/**
 * Configures UDP socket `socket`.
 * Binds event listeners.
 */
SSDP.prototype._start = function (cb) {
  var self = this

  if (self._started) {
    self._logger('Already started.')
    return
  }

  if (!this.sockets) {
    this._createSockets()
  }

  self._started = true

  var interfaces = Object.keys(this.sockets)

  async.each(interfaces, function (iface, next) {
    var socket = self.sockets[iface]

    socket.on('error', function onSocketError(err) {
      self._logger('Socker error: %s', err.message)
    })

    socket.on('message', function onSocketMessage(msg, rinfo) {
      self._parseMessage(msg, rinfo)
    })

    socket.on('listening', function onSocketListening() {
      var addr = socket.address()

      self._logger('SSDP listening: %o', {address: 'http://' + addr.address + ':' + addr.port, 'interface': iface})

      try {
        addMembership()
      } catch (e) {
        if (e.code === 'ENODEV' || e.code === 'EADDRNOTAVAIL') {
          self._logger('Interface %s is not present to add multicast group membership. Scheduling a retry. Error: %s', addr, e.message)
          setTimeout(addMembership, 5000)
        } else {
          throw e
        }
      }

      function addMembership() {
        socket.addMembership(self._ssdpIp, iface) // TODO: specifying the interface in there might make a difference
        socket.setMulticastTTL(self._ssdpTtl)
      }
    })

    if (self._explicitSocketBind) {
      socket.bind(self._sourcePort, iface, next)
    } else {
      socket.bind(self._sourcePort, next) // socket binds on 0.0.0.0
    }
  }, cb)
}



/**
 * Routes a network message to the appropriate handler.
 *
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseMessage = function (msg, rinfo) {
  msg = msg.toString()

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
    case c.NOTIFY:
      this._notify(headers, msg, rinfo)
      break
    case c.M_SEARCH:
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

    case c.SSDP_ALIVE:
      this.emit(c.ADVERTISE_ALIVE, headers, rinfo)
      break

    // Device shutting down.
    case c.SSDP_BYE:
      this.emit(c.ADVERTISE_BYE, headers, rinfo)
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
    , peer_addr = rinfo.address
    , peer_port = rinfo.port
    , stRegex
    , acceptor

  // unwrap quoted string
  if (serviceType[0] == '"' && serviceType[serviceType.length - 1] == '"') {
    serviceType = serviceType.slice(1, -1)
  }

  if (self._allowWildcards) {
    stRegex = new RegExp(serviceType.replace(/\*/g, '.*') + '$')
    acceptor = function (usn, serviceType) {
      return serviceType === c.SSDP_ALL || stRegex.test(usn)
    }
  } else {
    acceptor = function (usn, serviceType) {
      return serviceType === c.SSDP_ALL || usn === serviceType
    }
  }

  Object.keys(self._usns).forEach(function (usn) {
    var udn = self._usns[usn]

    if (self._allowWildcards) {
      udn = udn.replace(stRegex, serviceType)
    }

    if (acceptor(usn, serviceType)) {
      var header = new SsdpHeader('200 OK', {
        'ST': serviceType === c.SSDP_ALL ? usn : serviceType,
        'USN': udn,
        'CACHE-CONTROL': 'max-age=' + self._ttl,
        'DATE': new Date().toUTCString(),
        'SERVER': self._ssdpSig,
        'EXT': ''
      }, true)

      header.setHeaders(self._extraHeaders)

      if (self._location) {
        header.setHeader('LOCATION', self._location)
      } else {
        header.overrideLocationOnSend()
      }

      self._logger('Sending a 200 OK for an M-SEARCH: %o', {'peer': peer_addr, 'port': peer_port})

      self._send(header, peer_addr, peer_port, function (err, bytes) {
        self._logger('Sent M-SEARCH response: %o', {'message': header.toString(), id: header.id()})
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



SSDP.prototype._getMethod = function _getMethod(msg) {
  var lines = msg.split("\r\n")
    , type = lines.shift().split(' ')// command, such as "NOTIFY * HTTP/1.1"
    , method = (type[0] || '').toLowerCase()

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

  var ipAddresses = Object.keys(this.sockets)

  async.each(ipAddresses, function (ipAddress, next) {
    var socket = self.sockets[ipAddress]
    var buf

    if (message instanceof SsdpHeader) {
      if (message.isOverrideLocationOnSend()) {
        var location = self._locationProtocol + ipAddress + ':' + self._locationPort + self._locationPath
        self._logger('Setting LOCATION header "%s" on message ID %s', location, message.id())
        buf = message.toBuffer({'LOCATION': location})
      } else {
        buf = message.toBuffer()
      }
    } else {
      buf = message
    }

    self._logger('Sending a message to %s:%s', host, port)

    socket.send(buf, 0, buf.length, port, host, next)
  }, cb)
}



function getSsdpSignature() {
  return 'node.js/' + nodeVersion + ' UPnP/1.1 ' + moduleName + '/' + moduleVersion
}



module.exports = SSDP
