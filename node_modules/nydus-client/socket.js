var WS = require('ws')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , protocol = require('nydus-protocol')

module.exports = Socket

function Socket(host) {
  EventEmitter.call(this)
  this._host = host
}
inherits(Socket, EventEmitter)

Socket.prototype.open = function() {
  if (!WS) {
    throw new Error('WebSockets are not supported')
  }

  if (!this._ws || this._ws.readyState >= WebSocket.CLOSING) {
    this._ws = new WS(this._host)
    this._ws.onopen = this._onOpen.bind(this)
    this._ws.onclose = this._onClose.bind(this)
    this._ws.onerror = this._onError.bind(this)
    this._ws.onmessage = this._onMessage.bind(this)
  }

  return this
}

Socket.prototype.close = function() {
  if (this._ws && this._ws.readyState < WebSocket.CLOSING) {
    this._ws.close()
  }

  return this
}

Socket.prototype._onOpen = function() {
  this.emit('connect')
}

Socket.prototype._onClose = function(event) {
  this.emit('disconnect', event)
}

Socket.prototype._onError = function(event) {
  this.emit('error', event)
}

Socket.prototype._onMessage = function(event) {
  try {
    var message = protocol.decode(event.data)
  } catch (err) {
    this._ws.close(1002, 'Invalid nydus message')
    this.emit('error', err)
    return
  }

  this.emit('message', message)
  switch (message.type) {
    case protocol.WELCOME:
      this.emit('message:welcome', message)
      break
    case protocol.CALL:
      this.emit('message:call', message)
      break
    case protocol.RESULT:
      this.emit('message:result', message)
      break
    case protocol.ERROR:
      this.emit('message:error', message)
      break
    case protocol.SUBSCRIBE:
      this.emit('message:subscribe', message)
      break
    case protocol.UNSUBSCRIBE:
      this.emit('message:unsubscribe', message)
      break
    case protocol.PUBLISH:
      this.emit('message:publish', message)
      break
    case protocol.EVENT:
      this.emit('message:event', message)
      break
  }
}

Socket.prototype.sendMessage = function(message) {
  var encoded = protocol.encode(message)
  this.emit('send', message)
  this._ws.send(encoded)
}
