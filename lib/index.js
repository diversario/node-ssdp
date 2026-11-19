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
  , debug = require('debug')
  , os = require('os')
  , async = require('async')
  , SsdpHeader = require('./ssdpHeader')

var httpHeader = /HTTP\/\d{1}\.\d{1} \d+ .*/
  , ssdpHeader = /^([^:]+):\s*(.*)$/

/* consts */
var c = require('./const')

var nodeVersion = process.versions.node
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

  // Port of the sockets that send to the SSDP group. 0 lets the system pick.
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
    this._location = opts.location || 'http://' + getLocalIp() + ':' + 10293 + '/upnp/desc.html'
  }

  this._ssdpServerHost = this._ssdpIp + ':' + this._ssdpPort

  this._usns = {}
  this._udn = opts.udn || 'uuid:f40c2981-7329-40b7-8b04-27f187aecfb5'

  this._extraHeaders = opts.headers || {}

  this._allowWildcards = opts.allowWildcards

  this._mxDelay = opts.mxDelay === undefined ? true : opts.mxDelay

  this._suppressRootDeviceAdvertisements = opts.suppressRootDeviceAdvertisements
}



/**
 * Creates the UDP4 sockets.
 *
 * `this.sockets` holds one socket for every external IPv4 address. A socket
 * sends the messages for the SSDP group through its interface, and it
 * receives the answers to them.
 *
 * `this._listener` is one more socket. It joins the SSDP group on every one
 * of those interfaces. It receives M-SEARCH and NOTIFY, and it sends the
 * answers to M-SEARCH. There is only one, because every socket on the SSDP
 * port gets its own copy of each multicast message.
 *
 * @private
 */
SSDP.prototype._createSockets = function () {
  var interfaces = os.networkInterfaces()
    , self = this
    , sockets = {}
    , netmasks = {}
    , nics = {}

  function createSocket() {
    var socket = dgram.createSocket({type: 'udp4', reuseAddr: self._reuseAddr})

    socket.unref()

    return socket
  }

  Object.keys(interfaces).forEach(function (iName) {
    if (!self._interfaces || self._interfaces.indexOf(iName) > -1) {
      self._logger('discovering all IPs from interface %s', iName)

      interfaces[iName].forEach(function (ipInfo) {
        if (ipInfo.internal == false && ipInfo.family == "IPv4") {
          self._logger('Will use interface %s', iName)

          sockets[ipInfo.address] = createSocket()
          netmasks[ipInfo.address] = ipInfo.netmask
          // Linux lists an address that has a label under the name
          // `<interface>:<label>`. It still belongs to `<interface>`.
          nics[ipInfo.address] = iName.split(':')[0]
        }
      })
    }
  })

  if (Object.keys(sockets).length === 0) {
    throw new Error('No sockets available, cannot start.')
  }

  this.sockets = sockets
  this._netmasks = netmasks
  this._nics = nics
  this._joined = {}
  this._retryTimers = []
  this._listener = createSocket()
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

  this._listener.close()

  this.sockets = this._listener = null

  this._socketBound = this._started = false

  this._retryTimers.forEach(clearTimeout)

  // A start that is not done yet ends here, with an error.
  if (this._abortStart) this._abortStart()
}


/**
 * Binds the sockets and joins the SSDP group.
 * Calls `cb` with an error when that fails.
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

  var sockets = this.sockets
    , listener = this._listener
    , interfaces = Object.keys(sockets)
    , finished = false

  // Every way out of the start goes through here.
  function finish(err) {
    if (finished) return

    finished = true
    self._abortStart = null

    // After a failure the sockets are closed. `_stop` may have done that
    // already, and a later start has its own sockets.
    if (err && self._listener === listener) self._stop()

    cb(err)
  }

  this._abortStart = function () {
    finish(new Error('Stopped before the start was done'))
  }

  async.each(interfaces, function (iface, next) {
    var socket = sockets[iface]

    socket.on('message', function onSocketMessage(msg, rinfo) {
      msg = msg.toString()

      // Only answers to M-SEARCH are expected here. The listener handles
      // M-SEARCH and NOTIFY. This socket gets a copy of them too when
      // `sourcePort` is the SSDP port.
      if (isResponse(msg)) self._parseResponse(msg, rinfo)
    })

    // without an address the socket binds on 0.0.0.0
    self._bind(socket, self._sourcePort, self._explicitSocketBind ? iface : undefined, next)
  }, function (err) {
    if (finished) return
    if (err) return finish(err)

    listener.on('message', function onListenerMessage(msg, rinfo) {
      self._parseMessage(msg, rinfo)
    })

    self._bind(listener, self._ssdpPort, undefined, function (err) {
      if (finished) return
      if (err) return finish(err)

      var pending = interfaces.length
        , joined = false
        , inLoop = true
        , lastError

      // The start is done when one interface has joined. It fails when
      // every interface is skipped. An interface that is not present yet
      // gets a second try, and the start waits for that when no other
      // interface has joined.
      function settle() {
        if (joined) finish()
        else if (pending === 0) finish(lastError)
      }

      interfaces.forEach(function (iface) {
        self._joinGroup(iface, function (err) {
          pending--

          if (err) lastError = err
          else joined = true

          // In the loop, the start waits until every socket is set up.
          if (!inLoop) settle()
        })
      })

      inLoop = false

      settle()
    })
  })
}



/**
 * Binds one socket. Calls `cb` with an error when that fails.
 * An error on the socket after that is only logged.
 *
 * @param socket
 * @param {Number} port
 * @param {String} [address]
 * @param {Function} cb
 */
SSDP.prototype._bind = function (socket, port, address, cb) {
  var self = this
    , settled = false

  socket.on('error', function onSocketError(err) {
    self._logger('Socket error: %s', err.message)

    if (!settled) {
      settled = true
      cb(err)
    }
  })

  function onBound() {
    var addr = socket.address()

    self._logger('SSDP listening: %o', {address: 'http://' + addr.address + ':' + addr.port})

    settled = true
    cb()
  }

  // In a cluster worker, a socket that is not exclusive is shared with the
  // other workers. Windows cannot share a UDP socket at all.
  socket.bind({port: port, address: address, exclusive: true}, onBound)
}



/**
 * Makes the socket of one address send its multicast messages through the
 * interface of that address, and joins the SSDP group on that interface.
 *
 * An interface that cannot join is skipped. A warning names it, and the
 * messages that arrive there are not received. An interface that is not
 * present yet gets a second try after 5 seconds.
 *
 * @param {String} iface IPv4 address of the interface
 * @param {Function} done called once: without an argument when the
 *   interface has joined, with the error when it is skipped
 */
SSDP.prototype._joinGroup = function (iface, done) {
  var self = this
    , socket = this.sockets[iface]
    , listener = this._listener
    , nic = this._nics[iface]

  function join() {
    // Without this the system picks one interface for the multicast
    // messages of every socket.
    socket.setMulticastInterface(iface)
    socket.setMulticastTTL(self._ssdpTtl)

    // An interface can have several addresses. A socket can join a group
    // on an interface only once.
    if (self._joined[nic]) return

    listener.addMembership(self._ssdpIp, iface)

    self._joined[nic] = true
  }

  // One cause: Linux lets one socket have 20 memberships by default.
  function skip(e) {
    var message = 'Cannot join the multicast group ' + self._ssdpIp + ' on interface ' + nic + ' (' + iface + '): ' + e.message + '. Messages that arrive on this interface are not received.'

    self._logger(message)
    process.emitWarning(message, {code: 'NODE_SSDP_INTERFACE_SKIPPED'})

    done(e)
  }

  try {
    join()
  } catch (e) {
    if (e.code !== 'ENODEV' && e.code !== 'EADDRNOTAVAIL') return skip(e)

    self._logger('Interface %s is not present to add multicast group membership. Scheduling a retry. Error: %s', iface, e.message)

    // The start may be waiting for this timer. The sockets do not keep the
    // process running, so the timer has to. `_stop` clears it.
    var timer = setTimeout(function () {
      self._retryTimers.splice(self._retryTimers.indexOf(timer), 1)

      try {
        join()
      } catch (e) {
        return skip(e)
      }

      done()
    }, 5000)

    self._retryTimers.push(timer)

    return
  }

  done()
}



/**
 * Routes a network message to the appropriate handler.
 *
 * @param msg
 * @param rinfo
 */
SSDP.prototype._parseMessage = function (msg, rinfo) {
  msg = msg.toString()

  // HTTP/#.# ### Response to M-SEARCH
  if (isResponse(msg)) {
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
 * With the `mxDelay` option, the answer goes out after a random part of
 * the time that the search allows in its MX header.
 *
 * @param headers
 * @param msg
 * @param rinfo
 */
SSDP.prototype._msearch = function (headers, msg, rinfo) {
  var self = this
    , listener = this._listener

  this._logger('SSDP M-SEARCH event: %o', {'ST': headers.ST, 'address': rinfo.address, 'port': rinfo.port})

  if (!headers.MAN || !headers.MX || !headers.ST) return

  if (!this._mxDelay) return this._respondToSearch(headers.ST, rinfo)

  // Every device on the network gets the same search. Each one waits a
  // random time, so that the answers do not all arrive at the same moment.
  setTimeout(function () {
    // stopped, or stopping, in the meantime
    if (self._listener !== listener || self._stopping) return

    self._respondToSearch(headers.ST, rinfo)
  }, Math.random() * maxWait(headers.MX) * 1000).unref()
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

      self._send(header, peer_addr, peer_port, function (err) {
        if (err) {
          self._logger('Error: unable to send M-SEARCH response ID %s: %o', header.id(), err)
        } else {
          self._logger('Sent M-SEARCH response: %o', {'message': header.toString(), id: header.id()})
        }
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



/**
 * Sends a message.
 *
 * With `host` and `port`, one message goes to that host. It is sent from
 * the listener, so it comes from the SSDP port.
 *
 * Without them, the message goes to the SSDP group, once through every
 * interface.
 *
 * @param {SsdpHeader|Buffer} message
 * @param {String} [host]
 * @param {Number} [port]
 * @param {Function} cb
 */
SSDP.prototype._send = function (message, host, port, cb) {
  var self = this
    , buf

  if (typeof host !== 'function') {
    buf = self._toBuffer(message, self._addressFor(host))

    self._logger('Sending a message to %s:%s', host, port)

    return self._listener.send(buf, 0, buf.length, port, host, cb)
  }

  cb = host

  var firstError

  // Every socket finishes its send, also when another socket fails.
  async.each(Object.keys(this.sockets), function (ipAddress, next) {
    var buf = self._toBuffer(message, ipAddress)

    self._logger('Sending a message to %s:%s', self._ssdpIp, self._ssdpPort)

    self.sockets[ipAddress].send(buf, 0, buf.length, self._ssdpPort, self._ssdpIp, function (err) {
      firstError = firstError || err
      next()
    })
  }, function () {
    cb(firstError)
  })
}



/**
 * Turns a message into a buffer.
 *
 * @param {SsdpHeader|Buffer} message
 * @param {String} ipAddress Host for LOCATION, when the user gave none
 * @returns {Buffer}
 */
SSDP.prototype._toBuffer = function (message, ipAddress) {
  if (!(message instanceof SsdpHeader)) return message
  if (!message.isOverrideLocationOnSend()) return message.toBuffer()

  var location = this._locationProtocol + ipAddress + ':' + this._locationPort + this._locationPath

  this._logger('Setting LOCATION header "%s" on message ID %s', location, message.id())

  return message.toBuffer({'LOCATION': location})
}



/**
 * Returns the address of the interface that is on the same subnet as
 * `peer`. A message to `peer` leaves through that interface.
 * Returns the address of the first interface when no subnet matches.
 *
 * @param {String} peer IPv4 address
 * @returns {String}
 */
SSDP.prototype._addressFor = function (peer) {
  var addresses = Object.keys(this.sockets)
    , netmasks = this._netmasks

  return addresses.find(function (address) {
    return sameSubnet(address, peer, netmasks[address])
  }) || addresses[0]
}



function isResponse(msg) {
  return httpHeader.test(msg.split('\r\n').shift())
}



function ipToNumber(ip) {
  return String(ip).split('.').reduce(function (number, part) {
    return number * 256 + (parseInt(part, 10) || 0)
  }, 0)
}



function sameSubnet(a, b, netmask) {
  var mask = ipToNumber(netmask)

  return (ipToNumber(a) & mask) === (ipToNumber(b) & mask)
}



/**
 * Returns how many seconds the MX header of a search lets a device wait.
 * UPnP says to treat a value above 5 as 5.
 *
 * @param {String} mx value of the MX header
 * @returns {Number}
 */
function maxWait(mx) {
  var seconds = parseInt(mx, 10)

  if (!(seconds > 0)) return 0

  return Math.min(seconds, 5)
}



/**
 * Returns the first external IPv4 address of this host,
 * or the loopback address when there is none.
 *
 * @returns {String}
 */
function getLocalIp() {
  var interfaces = os.networkInterfaces()

  for (var name of Object.keys(interfaces)) {
    for (var info of interfaces[name]) {
      if (info.family === 'IPv4' && !info.internal) return info.address
    }
  }

  return '127.0.0.1'
}



function getSsdpSignature() {
  return 'node.js/' + nodeVersion + ' UPnP/1.1 ' + moduleName + '/' + moduleVersion
}



module.exports = SSDP
