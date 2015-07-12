// Easier, more readable way of retrieving an HTTP Error type for passing through Koa
// example: throw new httpErrors.Forbidden('No way, Jose'))

import http from 'http'
import util from 'util'

class HttpError extends Error {
  constructor(statusCode, message, cause) {
    super(message)

    this.status = +(statusCode || 500)
    this.message = message
    this.cause = cause
  }

  toString() {
    const str = this.name || this.constructor.name || this.constructor.prototype.name
    if (this.message) str += ': ' + this.message
    if (this.cause) str += '; caused by ' + this.cause.toString()

    return str
  }
}

Object.keys(http.STATUS_CODES)
  .filter(code => code >= 400)
  .forEach(code => {
    let errorName = http.STATUS_CODES[code]
      .split(/\s+/)
      .map(str => str.charAt(0).toUpperCase() + str.slice(1).toLowerCase())
      .join('')
      .replace(/\W+/g, '')

    errorName = errorName.substr(-5) === 'Error' ? (errorName) : (errorName + 'Error')

    module.exports[errorName] = function(message, cause) {
      HttpError.call(this, code, message, cause)
    }
    util.inherits(module.exports[errorName], HttpError)
    module.exports[errorName].prototype.name = errorName
  })
