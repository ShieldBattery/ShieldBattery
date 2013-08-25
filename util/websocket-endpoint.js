// Base class to make it easier to register Websocket API endpoints
// Simply create an inheriting type, add functions to it, and the first time #apply is called we'll
// build a table of socket events to register for and do so. After that, the functions are locked
// in. Any functions beginning with an underscore will be ignored.
function WebsocketEndpoint(io, base) {
  this.io = io
  this.__base = base
  this.__initialized = false
}

WebsocketEndpoint.prototype.apply = function(socket) {
  if (!this.__initialized) {
    this.__handlers = []
    for (var key in this) {
      if (key[0] != '_' && key != 'apply' && typeof this[key] == 'function') {
        this.__handlers.push({ eventName: this.__base + '/' + key, cb: this[key] })
      }
    }
    this.__initialized = true
  }

  for (var i = 0, len = this.__handlers.length; i < len; i++) {
    socket.on(this.__handlers[i].eventName, this.__handlers[i].cb.bind(this, socket))
  }
}

module.exports = WebsocketEndpoint
