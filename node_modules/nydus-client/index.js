var Socket = require('./socket')
  , EventEmitter = require('events').EventEmitter
  , inherits = require('inherits')
  , protocol = require('nydus-protocol')
  , idgen = require('idgen')
  , Backo = require('backo')
  , createRouter = require('./router')

module.exports = function(host) {
  return new NydusClient(host)
}

NydusClient.WELCOME_TIMEOUT = 25000

NydusClient.defaults =  { pingTimeout: 60000
                        , maxReconnectAttempts: -1
                        }

function NydusClient(host, options) {
  EventEmitter.call(this)
  this.socket = new Socket(host)
  this.socket.open()
  this.readyState = 'connecting'
  this.router = createRouter()
  this._forcedDisconnect = false

  this._options = options || {}
  for (var key in NydusClient.defaults) {
    if (typeof this._options[key] == 'undefined') {
      this._options[key] = NydusClient.defaults[key]
    }
  }

  this._backo = new Backo({ min: 100
                          , max: 400000
                          , jitter: 100
                          , factor: 4
                          })
  this._reconnectAttempts = 0
  this._setupPong()

  this._outstandingReqs = Object.create(null)
  this._subscriptions = Object.create(null)

  this.socket.on('connect', this._onConnect.bind(this))
    .on('disconnect', this._onDisconnect.bind(this))
    .on('error', this._onError.bind(this))
    .on('message:call', this._onCallMessage.bind(this))
    .on('message:result', this._onResultMessage.bind(this))
    .on('message:error', this._onErrorMessage.bind(this))
    .on('message:subscribe', this._onSubscribeMessage.bind(this))
    .on('message:unsubscribe', this._onUnsubscribeMessage.bind(this))
    .on('message:publish', this._onPublishMessage.bind(this))
    .on('message:event', this._onEventMessage.bind(this))

}
inherits(NydusClient, EventEmitter)

// call('/my/path', params..., function(err, results...) { })
NydusClient.prototype.call = function(path, params, cb) {
  if (this.readyState != 'connected') {
    var args = arguments
      , self = this
    this.once('connect', function() {
      self.call.apply(self, args)
    })
    return
  }

  var message = { type: protocol.CALL
                , requestId: this._getRequestId()
                , procPath: path
                }
    , callback = arguments.length > 1 ? arguments[arguments.length - 1] : function() {}
    , callParams = Array.prototype.slice.call(arguments, 1, arguments.length - 1)
  if (typeof callback != 'function') {
    callback = function() {}
    callParams.push(arguments[arguments.length - 1])
  }
  message.params = callParams
  this._outstandingReqs[message.requestId] = callback
  this.socket.sendMessage(message)
}

// subscribe('/my/path', function(event) { }, function(err) { })
NydusClient.prototype.subscribe = function(path, listener, cb) {
  var self = this
  if (this.readyState != 'connected') {
    var args = arguments
    this.once('connect', function() {
      self.subscribe.apply(self, args)
    })
    return
  }

  var message = { type: protocol.SUBSCRIBE
                , requestId: this._getRequestId()
                , topicPath: path
                }
    , callback = arguments.length > 2 ? cb : function() {}
  this._outstandingReqs[message.requestId] = function(err) {
    if (err) {
      // TODO(tec27): emit an error if no callback is set?
      return callback.apply(this, arguments)
    }

    if (!self._subscriptions[path]) {
      self._subscriptions[path] = [ listener ]
    } else {
      self._subscriptions[path].push(listener)
    }

    callback.apply(this, arguments)
  }
  this.socket.sendMessage(message)
}

// unsubscribe('/my/path', function(event) { }, function(err) { })
NydusClient.prototype.unsubscribe = function(path, listener, cb) {
  var self = this
  // TODO(tec27): handle cases where we aren't connected yet? Probably need to rework how the
  // similar handling works for subscribe to make that possible
  if (!self._subscriptions[path]) {
    throw new Error('No subscriptions exist for ' + path)
  }
  var index = self._subscriptions[path].indexOf(listener)
  if (index == -1) {
    throw new Error('The specified listener is not currently subscribed to ' + path)
  }

  var message = { type: protocol.UNSUBSCRIBE
                , requestId: this._getRequestId()
                , topicPath: path
                }
    , callback = arguments.length > 2 ? cb : function() {}
  this._outstandingReqs[message.requestId] = function(err) {
    if (err) {
      // TODO(tec27): emit an error if no callback is set?
      return callback.apply(this, arguments)
    }

    var index = self._subscriptions[path].indexOf(listener)
    if (index != -1) {
      self._subscriptions[path].splice(index, 1)
    }
    callback.apply(this, arguments)
  }
  this.socket.sendMessage(message)
}

// publish('/my/path', ..., [ excludeMe ])
NydusClient.prototype.publish = function(path, event, excludeMe) {
  var message = { type: protocol.PUBLISH
                , topicPath: path
                , event: event
                , excludeMe: excludeMe
                }
  this.socket.sendMessage(message)
}

NydusClient.prototype._getRequestId = function() {
  return idgen(16)
}

NydusClient.prototype._onConnect = function() {
  var self = this
  this._reconnectAttempts = 0
  this._backo.reset()
  this.socket.once('message:welcome', onWelcome)
    .once('disconnect', onDisconnect)

  var timeout = setTimeout(function() {
    self.socket.removeListener('message:welcome', onWelcome)
    this.forcedDisconnect = true
    self.socket.close()
    self.emit('error', new Error('Server did not send a WELCOME on connect'))
  }, NydusClient.WELCOME_TIMEOUT)

  function onWelcome(message) {
    clearTimeout(timeout)
    self.socket.removeListener('disconnect', onDisconnect)
    if (message.protocolVersion != protocol.protocolVersion) {
      this._forcedDisconnect = true
      self.socket.close()
      self.emit('error', new Error('Server is using an unsupported protocol version: ' +
          message.protocolVersion))
    } else {
      self._resetPingTimeout()
      self.readyState = 'connected'
      self.emit('connect')
    }
  }

  function onDisconnect(message) {
    clearTimeout(timeout)
    self.socket.removeListener('message:welcome', onWelcome)
  }
}

NydusClient.prototype._onError = function(err) {
  this.emit('error', err)
}

NydusClient.prototype._onDisconnect = function(event) {
  if (typeof this._pingTimeout != 'undefined') {
    clearTimeout(this._pingTimeout)
    delete this._pingTimeout
  }

  if (event && event.code == 4001) {
    this.emit('error', new Error('Unauthorized'))
  }

  this.readyState = 'disconnected'
  this.emit('disconnect')

  // TODO(tec27): maybe automatically resubscribe on reconnect instead?
  this._outstandingReqs = Object.create(null)
  this._subscriptions = Object.create(null)

  var shouldReconnect = !this._forcedDisconnect && (event && event.code != 4001)
  if (shouldReconnect) {
    this._attemptReconnect()
  }
  this._forcedDisconnect = false
}

NydusClient.prototype._attemptReconnect = function() {
  if (this._options.maxReconnectAttempts > 0 &&
      this._reconnectAttempts > this._options.maxReconnectAttempts) {
    return
  }

  this.reconnectAttempts++

  var self = this
  setTimeout(function() {
    self.socket.open()
  }, this._backo.duration())
}

NydusClient.prototype._onCallMessage = function(message) {
  var self = this
    , route = this.router.matchCall(message.procPath)
    , sent = false
  if (!route) {
    var response =  { type: protocol.ERROR
                    , requestId: message.requestId
                    , errorCode: 404
                    , errorDesc: 'not found'
                    , errorDetails: message.procPath + ' could not be found'
                    }
    return this.socket.sendMessage(response)
  }

  var req = { socket: this._socket
            , requestId: message.requestId
            , route: route.route
            , params: route.params
            , splats: route.splats
            }
    , res = { complete: complete, fail: fail }
    , args = [ req, res ].concat(message.params)

  route.fn.apply(this, args)

  function complete(results) {
    if (sent) {
      self.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    var args = Array.prototype.slice.apply(arguments)
      , response =  { type: protocol.RESULT
                    , requestId: message.requestId
                    , results: args
                    }
    self.socket.sendMessage(response)
    sent = true
  }

  function fail(errorCode, errorDesc, errorDetails) {
    if (sent) {
      self.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    var response =  { type: protocol.ERROR
                    , requestId: message.requestId
                    , errorCode: errorCode
                    , errorDesc: errorDesc
                    , errorDetails: errorDetails
                    }
    self.socket.sendMessage(response)
    sent = true
  }
}

NydusClient.prototype._onResultMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this.emit('error',
      new Error('Received a result for an unrecognized requestId: ' + message.requestId))
  }
  delete this._outstandingReqs[message.requestId]

  var results = [ null /* err */ ].concat(message.results)
  cb.apply(this, results)
}

NydusClient.prototype._onErrorMessage = function(message) {
  var cb = this._outstandingReqs[message.requestId]
  if (!cb) {
    return this.emit('error',
      new Error('Received an error for an unrecognized requestId: ' + message.requestId))
  }
  delete this._outstandingReqs[message.requestId]

  var err = { code: message.errorCode
            , desc: message.errorDesc
            , details: message.errorDetails
            }
  cb.call(this, err)
}

NydusClient.prototype._onSubscribeMessage = function(message) {
  // We don't support subscribing to clients, so give the server an error
  var reply = { type: protocol.ERROR
              , requestId: message.requestId
              , errorCode: 405
              , errorDesc: 'method not allowed'
              , errorDetails: 'client does not support subscriptions'
              }
  this.socket.sendMessage(reply)
}

NydusClient.prototype._onUnsubscribeMessage = function(message) {
  // We don't support subscribing to clients, so any unsubscribe is also an error
  var reply = { type: protocol.ERROR
              , requestId: message.requestId
              , errorCode: 405
              , errorDesc: 'method not allowed'
              , errorDetails: 'client does not support subscriptions'
              }
  this.socket.sendMessage(reply)
}

NydusClient.prototype._onPublishMessage = function(message) {
  // We don't support publishing events to clients, so drop the message
}

NydusClient.prototype._onEventMessage = function(message) {
  if (!this._subscriptions[message.topicPath]) {
    return
  }

  var listeners = this._subscriptions[message.topicPath]
  for (var i = 0, len = listeners.length; i < len; i++) {
    listeners[i].call(this, message.event)
  }
}

NydusClient.prototype._setupPong = function() {
  var self = this
  this.router.call('/_/ping', function(req, res) {
    res.complete()
    self._resetPingTimeout()
  })
}

NydusClient.prototype._resetPingTimeout = function() {
  if (typeof this._pingTimeout != 'undefined') {
    clearTimeout(this._pingTimeout)
  }

  var self = this
  this._pingTimeout = setTimeout(onTimeout, this._options.pingTimeout)
  function onTimeout() {
    delete self._pingTimeout
    self.socket.close()
  }
}
