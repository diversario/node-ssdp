'use strict'

var dgram = require('dgram')
  , EE = require('events').EventEmitter
  , dns = require('dns')
  , os = require('os')
  , util = require('util')
  , Logger = require('./logger')


var httpHeader = /HTTP\/\d{1}\.\d{1} \d+ .*/
  , ssdpHeader = /^([^:]+):\s*(.*)$/

/**
 * Options:
 * 
 * @param {Object} opts
 * @param {String} opts.ssdpSig SSDP signature
 * @param {String} opts.ssdpIp SSDP multicast group
 * @param {String} opts.ssdpPort SSDP port
 * @param {Number} opts.ssdpTtl Multicast TTL
 * @param {String} opts.description Path to SSDP description file
 * @param {String} opts.udn SSDP Unique Device Name
 * 
 * @param {Number} opts.ttl Packet TTL
 * @param {Boolean} opts.log Disable/enable logging
 * @param {String} opts.logLevel Log level
 * 
 * @returns {SSDP}
 * @constructor
 */
function SSDP(opts) {
  var self = this

  if (!(this instanceof SSDP)) return new SSDP(opts)

  opts = opts || {}
  
  EE.call(self)

  this._logger = Logger(opts)
  
  this._init(opts)
  this._start()

  process.on('exit', function () {
    self.stop()
  })
}


util.inherits(SSDP, EE)



/**
 * Initializes instance properties.
 * @param opts
 * @private
 */
SSDP.prototype._init = function (opts) {
  this._ssdpSig = opts.ssdpSig || getSsdpSignature()

  this._ssdpIp = opts.ssdpIp || '239.255.255.250'
  this._ssdpPort = opts.ssdpPort || 1900
  this._ssdpTtl = opts.ssdpTtl || 1

  this._ipPort = this._ssdpIp + ':' + this._ssdpPort

  this._ttl = opts.ttl || 1800

  this._description = opts.description || 'upnp/desc.html'

  this._usns = {}
  this._udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'
}



/**
 * Creates and configures a UDP socket.
 * Binds event listeners.
 * 
 */
SSDP.prototype._start = function () {
  var self = this

  // Configure socket for either client or server.
  self.responses = {}

  this.sock = dgram.createSocket('udp4')

  this.sock.on('error', function (err) {
    self._logger.error(err, 'Socker error')
  })

  this.sock.on('message', function onMessage(msg, rinfo) {
    self._parseMessage(msg, rinfo)
  })

  this.sock.on('listening', function onListening() {
    var addr = self.sock.address()
    
    self._logger.info('SSDP listening on ' + 'http://' + addr.address + ':' + addr.port)

    self.sock.addMembership(self._ssdpIp)
    self.sock.setMulticastTTL(self._ssdpTtl)
  })
}



/**
 * Routes a network message to the appropriate handler.
 * 
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseMessage = function (msg, rinfo) {
  msg = msg.toString()

  this._logger.trace({message: '\n' + msg}, 'Multicast message')

  var type = msg.split('\r\n').shift()

  // HTTP/#.# ### Response
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
  var lines = msg.toString().split("\r\n")
    , type = lines.shift().split(' ')// command, such as "NOTIFY * HTTP/1.1"
    , method = type[0]

  var headers = {}

  lines.forEach(function (line) {
    if (line.length) {
      var pairs = line.match(ssdpHeader)
      if (pairs) headers[pairs[1].toUpperCase()] = pairs[2] // e.g. {'HOST': 239.255.255.250:1900}
    }
  })

  switch (method) {
    case 'NOTIFY':
      this._notify(headers, msg, rinfo)
      break
    case 'M-SEARCH':
      this._msearch(headers, msg, rinfo)
      break
    default:
      this._logger.warn({'message': '\n' + msg, 'rinfo': rinfo}, 'Unhandled NOTIFY event')
  }
}



/**
 * Handles NOTIFY command
 *
 * @param headers
 * @param msg
 * @param rinfo
 */
SSDP.prototype._notify = function (headers, msg, rinfo) {
  if (!headers.NTS) this._logger.trace(headers, 'Missing NTS header')

  switch (headers.NTS.toLowerCase()) {
    // Device coming to life.
    case 'ssdp:alive':
      this.emit('advertise-alive', headers)
      break

    // Device shutting down.
    case 'ssdp:byebye':
      this.emit('advertise-bye', headers)
      break

    default:
      this._logger.trace({'message': '\n' + msg, 'rinfo': rinfo}, 'Unhandled NOTIFY event')
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
  this._logger.trace({'ST': headers.ST, 'address': rinfo['address'], 'port': rinfo['port']}, 'SSDP M-SEARCH event')

  if (!headers['MAN'] || !headers['MX'] || !headers['ST']) return

  this._inMSearch(headers['ST'], rinfo)
}



/**
 * Parses SSDP response message.
 * 
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseResponse = function parseResponse(msg, rinfo) {
  if (!this.responses[rinfo.address]) {
    this.responses[rinfo.address] = true
    this._logger.info({'message': '\n' + msg}, 'SSDP response')
  }

  this.emit('response', msg, rinfo)
}



SSDP.prototype._inMSearch = function (st, rinfo) {
  var self = this
    , peer = rinfo.address
    , port = rinfo.port

  if (st[0] == '"' && st[st.length-1] == '"') st = st.slice(1, -1) // unwrap quoted string

  Object.keys(self._usns).forEach(function (usn) {
    var udn = self._usns[usn]

    if (st == 'ssdp:all' || usn == st) {
      var pkt = self.getSSDPHeader(
        '200 OK',
        {
          'ST': usn,
          'USN': udn,
          'LOCATION': self._httphost + '/' + self._description,
          'CACHE-CONTROL': 'max-age=' + self._ttl,
          'DATE': new Date().toUTCString(),
          'SERVER': self._ssdpSig,
          'EXT': ''
        },
        true
      )
      
      self._logger.trace({'peer': peer, 'port': port}, 'Sending a 200 OK for an M-SEARCH')
      
      var message = new Buffer(pkt)
      
      self.sock.send(message, 0, message.length, port, peer, function (err, bytes) {
        self._logger.trace({'message': pkt}, 'Sent M-SEARCH response')
      })
    }
  })
}



SSDP.prototype.addUSN = function (device) {
  this._usns[device] = this._udn + '::' + device
}


SSDP.prototype.search = function search(st) {
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

    self.sock.send(message, 0, message.length, self._ssdpPort, self._ssdpIp, function (err, bytes) {
      self._logger.trace({'message': pkt}, 'Sent M-SEARCH request')
    })
  })
}



/**
 * Binds UDP socket to an interface/port
 * and starts advertising.
 * 
 * @param ip
 * @param [portno]
 */
SSDP.prototype.server = function (ip, portno) {
  var self = this

  if (!portno) portno = '10293'
  
  this._usns[this._udn] = this._udn
  
  this._logger.trace('Will try to bind to ' + ip + ':' + this._ssdpPort)

  if (!ip || ip == '0.0.0.0') {
    dns.lookup(os.hostname(), function (err, add) {
      self._httphost = 'http://' + add + ':' + portno  
      bind()
    })
  } else {
    this._httphost = 'http://' + ip + ':' + portno
    bind()
  }

  function bind() {
    self.sock.bind(self._ssdpPort, ip, function () {
      self._logger.info('UDP socket bound to ' + ip + ':' + self._ssdpPort)

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
SSDP.prototype.stop = function () {
  this.advertise(false)
  this.advertise(false)
  this.sock.close()
}



/**
 * 
 * @param alive
 */
SSDP.prototype.advertise = function (alive) {
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



SSDP.prototype.getSSDPHeader = function (head, vars, res) {
  var ret = ''

  if (res == null) res = false

  if (res) {
    ret = "HTTP/1.1 " + head + "\r\n"
  } else {
    ret = head + " * HTTP/1.1\r\n"
  }

  Object.keys(vars).forEach(function (n) {
    ret += n + ": " + vars[n] + "\r\n"
  })

  return ret + "\r\n"
}


function getSsdpSignature() {
  var nodeVersion = process.version.substr(1)
    , moduleVersion = require('./package.json').version
    , moduleName = require('./package.json').name

  return 'node.js/' + nodeVersion + ' UPnP/1.1 ' + moduleName + '/' + moduleVersion 
}


module.exports = SSDP
