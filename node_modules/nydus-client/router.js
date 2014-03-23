var Router = require('routes')

module.exports = function() {
  return new NydusClientRouter()
}

function NydusClientRouter() {
  this._callRouter = new Router()
}

NydusClientRouter.prototype.call = function(path, fn) {
  this._callRouter.addRoute(path, fn)
  return this
}

NydusClientRouter.prototype.matchCall = function(path) {
  return this._callRouter.match(path)
}
