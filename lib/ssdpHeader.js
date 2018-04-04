var extend = require('extend')
  , random = require('crypto').randomBytes

function SsdpHeader(method, headers, isResponse) {
  this._method = method
  this._headers = extend ({}, headers || {})
  this._isResponse = isResponse
  this._id = random(8).toString('hex')

  if (!this._method) throw new Error('SSDP header requires method.')
}

SsdpHeader.prototype.id = function () {
  return this._id
}

SsdpHeader.prototype.setHeader = function (key, value) {
  if (key !== undefined && value !== undefined) {
    this._headers[key] = value
  }
}

SsdpHeader.prototype.setHeaders = function (headers) {
  if (headers && headers.toString && headers.toString() === '[object Object]') {
    extend(this._headers, headers)
  }
}

SsdpHeader.prototype.isResponse = function () {
  return !!this._isResponse
}

SsdpHeader.prototype.overrideLocationOnSend = function () {
  this._overrideLocationOnSend = true
}

SsdpHeader.prototype.isOverrideLocationOnSend = function () {
  return !!this._overrideLocationOnSend
}

SsdpHeader.prototype.toString = function (extraHeaders) {
  extraHeaders = extraHeaders || {}

  // SSDP header values should be simple primitives
  // so not worried here about deep copying or modifying by reference
  var headers = extend({}, this._headers)
  extend(headers, extraHeaders)

  var message = []

  var method = this._method.toUpperCase()

  if (this.isResponse()) {
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

SsdpHeader.prototype.toBuffer = function (extraHeaders) {
  return Buffer.from(this.toString(extraHeaders), 'ascii')
}

module.exports = SsdpHeader