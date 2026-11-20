var random = require('crypto').randomBytes

/**
 * Copies every header that has a value from `source` to `target`.
 *
 * @param {Object} target
 * @param {Object} [source]
 * @returns {Object} `target`
 */
function copyHeaders(target, source) {
  for (var name in source) {
    if (source[name] === undefined) continue

    // A plain assignment to the name `__proto__` adds no header. It changes
    // the prototype of `target`.
    Object.defineProperty(target, name, {
      value: source[name],
      writable: true,
      enumerable: true,
      configurable: true
    })
  }

  return target
}

function SsdpHeader(method, headers, isResponse) {
  this._method = method
  this._headers = copyHeaders({}, headers)
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
    copyHeaders(this._headers, headers)
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
  // SSDP header values should be simple primitives
  // so not worried here about deep copying or modifying by reference
  var headers = copyHeaders({}, this._headers)
  copyHeaders(headers, extraHeaders)

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
  // One byte for every character. A character above U+00FF has no byte of
  // its own. It becomes `?`. Without that, only its low byte is kept. The
  // low byte of `č` (U+010D) is a carriage return. A carriage return can
  // start a new header.
  return Buffer.from(this.toString(extraHeaders).replace(/[\u0100-\uffff]/g, '?'), 'latin1')
}

module.exports = SsdpHeader