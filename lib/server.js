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

var SSDP = require('./')
  , util = require('util')
  , assert = require('assert')
  , async = require('async')
  , c = require('./const')
  , Promise = require('bluebird')
  , SsdpHeader = require('./ssdpHeader')

function SsdpServer(opts) {
  this._subclass = 'node-ssdp:server'

  SSDP.call(this, opts)

  this._adLoopInterval = null
}

util.inherits(SsdpServer, SSDP)


/**
 * Binds UDP socket to an interface/port
 * and starts advertising.
 *
 * @param [Function] callback to socket.bind
 * @returns [Promise] promise when socket.bind is ready
 */
SsdpServer.prototype.start = function (cb) {
  var self = this

  if (self._socketBound) {
    self._logger('Server already running.')
    return
  }

  self._socketBound = true

  if (!self._suppressRootDeviceAdvertisements) {
    this._usns[this._udn] = this._udn
  }

  return new Promise(function(success, failure) {
    function onBind(err) {
      if (!err) self._initAdLoop()
      if (cb) cb.apply(self, arguments)
      if (err) return failure(err)
      success()
    }
    self._start(onBind)
  })
}


/**
 * Binds UDP socket
 *
 * @param ipAddress
 * @private
 */
SsdpServer.prototype._initAdLoop = function () {
  var self = this

  // Wake up.
  setTimeout(self.advertise.bind(self), 3000)

  self._startAdLoop()
}




/**
 * Advertises shutdown, then closes the UDP sockets.
 * The sockets close only after every `ssdp:byebye` message is sent.
 *
 * A server whose `start` is not done yet advertised nothing. It only closes
 * the sockets, and that `start` ends with an error.
 *
 * @param [Function] callback, called when the sockets are closed
 * @returns [Promise] resolved when the sockets are closed
 */
SsdpServer.prototype.stop = function (cb) {
  var self = this

  if (!this.sockets) {
    this._logger('Already stopped.')
  } else if (this._stopping) {
    this._logger('Already stopping.')
  } else if (this._adLoopInterval === null) {
    this._stop()
  } else {
    this._stopAdLoop()

    this._stopping = new Promise(function (resolve) {
      self.advertise(false, resolve)
    }).then(function () {
      self._stop()
      self._stopping = null
    })
  }

  return Promise.resolve(this._stopping).asCallback(cb)
}



SsdpServer.prototype._startAdLoop = function () {
  assert.strictEqual(this._adLoopInterval, null, 'Attempting to start a parallel ad loop')

  this._adLoopInterval = setInterval(this.advertise.bind(this), this._adInterval)
}



SsdpServer.prototype._stopAdLoop = function () {
  assert.notStrictEqual(this._adLoopInterval, null, 'Attempting to clear a non-existing interval')

  clearInterval(this._adLoopInterval)
  this._adLoopInterval = null
}



/**
 * Sends one NOTIFY message for every USN.
 *
 * @param [Boolean] alive `false` sends `ssdp:byebye`. Default: `true`, sends `ssdp:alive`
 * @param [Function] cb called when every message is sent
 */
SsdpServer.prototype.advertise = function (alive, cb) {
  var self = this

  if (alive === undefined) alive = true
  if (!cb) cb = function () {}

  // A server that is stopping only says byebye.
  if (!this.sockets || (alive && this._stopping)) return cb()

  async.each(Object.keys(self._usns), function (usn, next) {
    var udn = self._usns[usn]
      , nts = alive ? c.SSDP_ALIVE : c.SSDP_BYE // notification sub-type

    var header = new SsdpHeader(c.NOTIFY, {
      'HOST': self._ssdpServerHost,
      'NT': usn, // notification type, in this case same as ST
      'NTS': nts,
      'USN': udn
    })

    if (alive) {
      if (self._location) {
        header.setHeader('LOCATION', self._location)
      } else {
        header.overrideLocationOnSend()
      }

      header.setHeader('CACHE-CONTROL', 'max-age=1800')
      header.setHeader('SERVER', self._ssdpSig)
    }

    header.setHeaders(self._extraHeaders)

    self._logger('Sending an advertisement event')

    self._send(header, function (err) {
      if (err) {
        self._logger('Error: unable to send server message ID %s: %o', header.id(), err)
      } else {
        self._logger('Outgoing server message: %o', {'message': header.toString(), id: header.id()})
      }

      next()
    })
  }, cb)
}

module.exports = SsdpServer
