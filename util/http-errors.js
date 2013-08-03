// Easier, more readable way of retrieving an HTTP Error type for passing through Express
// example: return next(new httpErrors.Forbidden('No way, Jose'))

var http = require('http')
  , util = require('util')

function HttpError(statusCode, message, cause) {
  Error.call(this, message)

  this.status = +(statusCode || 500)
  this.message = message
  this.cause = cause
}
util.inherits(HttpError, Error)

HttpError.prototype.toString = function() {
  var str = this.name || this.constructor.name || this.constructor.prototype.name
  if (this.message) str += ': ' + this.message
  if (this.cause) str += '; caused by ' + this.cause.toString()

  return str
}

Object.keys(http.STATUS_CODES)
  .filter(function(code) { return code >= 400 })
  .forEach(function(code) {
    var errorName = http.STATUS_CODES[code]
      .split(/\s+/)
      .map(function(str) { return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() })
      .join('')
      .replace(/\W+/g, '')

    errorName = errorName.substr(-5) == 'Error' ? (errorName) : (errorName + 'Error')

    module.exports[errorName] = function(message, cause) {
      HttpError.call(this, code, message, cause)
    }
    util.inherits(module.exports[errorName], HttpError)
    module.exports[errorName].prototype.name = errorName
  })
