var EventEmitter = require('events').EventEmitter
  , util = require('util')
  , protocol = require('nydus-protocol')
  , idgen = require('idgen')

module.exports = Socket

function Socket(websocket, id) {
  EventEmitter.call(this)
  this.id = id
  this._websocket = websocket
  this.connected = true

  this._outstandingReqs = Object.create(null)

  this._websocket.on('close', function(code, message) {
    var wasConnected = this.connected
    this.connected = false
    this.emit('close', code, message)
    if (wasConnected) {
      this.emit('disconnect')
    }
  }.bind(this)).on('ping', function(data, flags) {
    this.emit('ping', data, flags)
  }.bind(this)).on('pong', function(data, flags) {
    this.emit('pong', data, flags)
  }.bind(this))

  this._websocket.on('message', this._onMessage.bind(this))
    .on('error', this._onError.bind(this))
}
util.inherits(Socket, EventEmitter)

// Send data over the websocket (this is a "raw" function and doesn't do any sort of encoding)
Socket.prototype._send = function(data, cb) {
  this._websocket.send(data, function(err) {
    if (cb) {
      cb(err)
    } else {
      // Swallow the error so that we don't crash because a socket closed before the data got there.
      // If no callback was provided, its assumed that this was a 'fire and forget' type message and
      // therefore this error is rather irrelevant
    }
  })
}

Socket.prototype._onMessage = function(data, flags) {
  try {
    var message = protocol.decode(data)
  } catch (err) {
    this._websocket.close(1002, 'Invalid nydus message')
    this._onError(err)
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
      this._onResultMessage(message)
      this.emit('message:result', message)
      break
    case protocol.ERROR:
      this._onErrorMessage(message)
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

Socket.prototype._onError = function(err) {
  var wasConnected = this.connected
  this.connected = false
  this.emit('error', err)
  if (wasConnected) {
    this.emit('disconnect')
  }
}

Socket.sendEventToAll = function(sockets, topicPath, event) {
  var message = { type: protocol.EVENT
                , topicPath: topicPath
                , event: event
                }
    , encoded = protocol.encode(message)
  for (var i = 0, len = sockets.length; i < len; i++) {
    sockets[i]._send(encoded)
  }
}

Socket.prototype.disconnect = function(code, data) {
  var wasConnected = this.connected
  this.connected = false
  this._websocket.close(code || 1000, data)
  if (wasConnected) {
    this.emit('disconnect')
  }
}

Socket.prototype.terminate = function() {
  var wasConnected = this.connected
  this.connected = false
  this._websocket.terminate()
  if (wasConnected) {
    this.emit('disconnect')
  }
}

Socket.prototype.sendResult = function(requestId, results, cb) {
  if (typeof results == 'function') {
    cb = results
    results = undefined
  }
  var message = { type: protocol.RESULT
                , requestId: requestId
                , results: results
                }
  this._send(protocol.encode(message), cb)
}

Socket.prototype.sendError = function(requestId, errorCode, errorDesc, errorDetails, cb) {
  if (typeof errorDetails == 'function') {
    cb = errorDetails
    errorDetails = undefined
  }
  var message = { type: protocol.ERROR
                , requestId: requestId
                , errorCode: errorCode
                , errorDesc: errorDesc
                , errorDetails: errorDetails
                }
  this._send(protocol.encode(message), cb)
}

Socket.prototype.call = function(procPath, params, cb) {
  var message = { type: protocol.CALL
                , requestId: idgen(16)
                , procPath: procPath
                }
    , callback = arguments.length > 1 ? arguments[arguments.length - 1] : function() {}
    , callParams = Array.prototype.slice.call(arguments, 1, arguments.length - 1)
  if (typeof callback != 'function') {
    callback = function() {}
    callParams.push(arguments[arguments.length - 1])
  }
  message.params = callParams
  this._outstandingReqs[message.requestId] = callback
  this._send(protocol.encode(message))
}

Socket.prototype.publish = function(topicPath, event) {
  var message = { type: protocol.EVENT
                , topicPath: topicPath
                , event: event
                }
    , encoded = protocol.encode(message)
  this._send(encoded)
}

Socket.prototype._onResultMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this._onError('Received a result for an unrecognized requestId: ' + message.requestId)
  }
  delete this._outstandingReqs[message.requestId]

  var results = [ null /* err */ ].concat(message.results)
  cb.apply(this, results)
}

Socket.prototype._onErrorMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this._onError('Received an error for an unrecognized requestId: ' + message.requestId)
  }
  delete this._outstandingReqs[message.requestId]

  var err = { code: message.errorCode
            , desc: message.errorDesc
            , details: message.errorDetails
            }
  cb.call(this, err)
}
