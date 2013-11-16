// Handling for chat, allowing for simple registration of commands and for becoming an exclusive
// reader of chat (i.e. receiving events for each line and not having those lines go through any
// registered commands first)
var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , stream = require('stream')

module.exports = function(bw) {
  return new ChatHandler(bw)
}

function ChatHandler(bw) {
  EventEmitter.call(this)
  this.bw = bw
  this.bw.bindings.onCheckForChatCommand = this._onChatLine.bind(this)
}
util.inherits(ChatHandler, EventEmitter);

ChatHandler.prototype._onChatLine = function(message, type, recipients) {
  if (!message) return // BW calls these methods even if no message was typed

  if (this._exclusive) {
    this._exclusive._addLine(message)
    return
  }

  var convertedType
  switch(type) {
    case 2: convertedType = 'all'; break
    case 3: convertedType = 'allies'; break
    case 4: convertedType = 'player'; break
    default: convertedType = 'unknown'
  }

  var command = message.split(' ', 1)[0]
    , handled = this.emit(command, message, convertedType, recipients)

  if (!handled) {
    // we didn't handle it, so send it back to BW so it goes through to other users
    this.bw.bindings.sendMultiplayerChatMessage(message, type, recipients)
  }
}

ChatHandler.prototype.grabExclusiveStream = function() {
  if (this._exclusive) {
    throw new Error('Exclusive lock already obtained')
  }

  var self = this
  this._exclusive = new ChatStream(function() {
    self.bw.displayIngameMessage.apply(self.bw, arguments)
  }, function() {
    self._exclusive = null
  })

  return this._exclusive
}

function ChatStream(displayFunc, closeCb) {
  stream.Duplex.call(this)
  this.displayFunc = displayFunc
  this.closeCb = closeCb || function() {}
  this._closed = false

  this._sendBuffer = ''
  this._timeout = 0

  var self = this
  this.once('finish', function() {
    if (self._sendBuffer) {
      var lines = self._sendBuffer.split('\n')
      for (var i = 0; i < lines.length; i++) {
        displayFunc(lines[i], self._timeout)
      }
      self._sendBuffer = ''
    }
  })
}
util.inherits(ChatStream, stream.Duplex)

ChatStream.prototype.close = function() {
  if (this._closed) return
  this.closeCb()
  this.push(null)
}

ChatStream.prototype._addLine = function(line) {
  if (this._closed) return
  this.write(line + '\n')
  this.push(line + '\n')
}

ChatStream.prototype._read = function() {
  // nothing to do, since our source (chat) tells us when stuff is ready and we can't pause it
}

ChatStream.prototype._write = function(chunk, encoding, next) {
  if (this._closed) {
    next(new Error('Stream is already closed'))
    return
  }

  var newBuffer = this._sendBuffer + chunk
    , lines = newBuffer.split('\n')
  for (var i = 0; i < lines.length - 1; i++) {
    this.displayFunc(lines[i], this._timeout)
  }

  this._sendBuffer = lines[lines.length - 1]
  next()
}

ChatStream.prototype.end = function() {
  stream.Duplex.prototype.end.apply(this, arguments)
  this.close()
  this._closed = true
}

ChatStream.prototype.setMessageTimeout = function(timeout) {
  this._timeout = timeout
}
