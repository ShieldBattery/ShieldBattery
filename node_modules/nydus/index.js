var ws = require('ws')
  , protocol = require('nydus-protocol')
  , EventEmitter = require('events').EventEmitter
  , util = require('util')
  , uuid = require('node-uuid')
  , Socket = require('./socket')
  , createRouter = require('./router')
  , packageJson = require('./package.json')

module.exports = function(httpServer, options) {
  return new NydusServer(httpServer, options)
}

NydusServer.defaults =  { serverAgent: 'NydusServer/' + packageJson.version
                        , pingInterval: 25000
                        , pingTimeout: 60000
                        , authorize: null
                        }

function NydusServer(httpServer, options) {
  EventEmitter.call(this)
  this._ws = new ws.Server({ server: httpServer })
  this.router = createRouter()

  this._sockets = Object.create(null)
  this._subscriptions = Object.create(null)
  this._socketSubs = Object.create(null)
  this._pingTimeouts = Object.create(null)
  this._pingIntervals = Object.create(null)

  this._options = options || {}
  for (var key in NydusServer.defaults) {
    if (typeof this._options[key] == 'undefined') {
      this._options[key] = NydusServer.defaults[key]
    }
  }

  ; [ '_onError'
    , '_onConnection'
    ].forEach(function(fn) {
      this[fn] = this[fn].bind(this)
    }, this)

  this._ws.on('error', this._onError)
    .on('connection', this._onConnection)

  // construct a welcome message to save time, since it will never change
  this._welcomeMessage = protocol.encode( { type: protocol.WELCOME
                                          , serverAgent: this._options.serverAgent
                                          })
}
util.inherits(NydusServer, EventEmitter)

NydusServer.prototype.publish = function(topicPath, event) {
  var socketIds = Object.keys(this._subscriptions[topicPath] || {})
  if (!socketIds.length) {
    return
  }
  var sockets = socketIds.map(function(id) {
    return this._sockets[id]
  }, this)
  Socket.sendEventToAll(sockets, topicPath, event)
}

NydusServer.prototype._onConnection = function(websocket) {
  var id = uuid.v4()
  var socket = new Socket(websocket, id)
  this._sockets[id] = socket
  this._socketSubs[id] = Object.create(null)

  var self = this
  socket.on('disconnect', function() {
    delete self._sockets[id]
    for (var topic in self._socketSubs[id]) {
      delete self._subscriptions[topic][id]
    }
    delete self._socketSubs[id]

    if (typeof self._pingTimeouts[id] != 'undefined') {
      clearTimeout(self._pingTimeouts[id])
      delete self._pingTimeouts[id]
    }
    if (typeof self._pingIntervals[id] != 'undefined') {
      clearTimeout(self._pingIntervals[id])
      delete self._pingIntervals[id]
    }

    self.emit('disconnect', socket)
  }).on('error', function() {}) // swallow socket errors if no one else handles them

  if (this._options.authorize) {
    var req = websocket.upgradeReq
      , info =  { origin: req.headers.origin
                , secure: typeof req.connection.authorized != 'undefined' ||
                    typeof req.connection.encrypted != 'undefined'
                , req: req
                }
    this._options.authorize(info, function(authorized, handshakeData) {
      if (authorized) {
        if (handshakeData) {
          socket.handshake = handshakeData
        }
        initialize()
      } else {
        socket.disconnect(4001, 'unauthorized')
      }
    })
  } else {
    initialize()
  }

  function initialize() {
    socket.on('message:call', function(message) {
      self._onCall(socket, message)
    }).on('message:subscribe', function(message) {
      self._onSubscribe(socket, message)
    }).on('message:unsubscribe', function(message) {
      self._onUnsubscribe(socket, message)
    }).on('message:publish', function(message) {
      self._onPublish(socket, message)
    })

    self._startPingInterval(socket)

    socket._send(self._welcomeMessage)
    self.emit('connection', socket)
  }
}

NydusServer.prototype._onError = function(err) {
  this.emit('error', err)
}

NydusServer.prototype._onCall = function(socket, message) {
  var route = this.router.matchCall(message.procPath)
  if (!route) {
    return socket.sendError(message.requestId, 404, 'not found',
        { message: message.procPath + ' could not be found' })
  }

  var req = createReq(socket, message.requestId, route, message.procPath)
    , res = createRes(this, socket, message.requestId, responseCallback)
    , args = [ req, res ].concat(message.params)

  route.fn.apply(this, args)

  function responseCallback() {}
}

NydusServer.prototype._onSubscribe = function(socket, message) {
  var self = this
    , route = this.router.matchSubscribe(message.topicPath)
  if (!route) {
    return socket.sendError(message.requestId, 404, 'not found',
        { message: message.topicPath + ' could not be found' })
  }

  var req = createReq(socket, message.requestId, route, message.topicPath)
    , res = createRes(this, socket, message.requestId, responseCallback)
    , args = [ req, res ].concat(message.params)

  route.fn.apply(this, args)

  function responseCallback(erred) {
    if (erred) {
      return
    }

    var sub = self._subscriptions[message.topicPath]
      , socketSub = self._socketSubs[socket.id]
    if (!sub) {
      sub = self._subscriptions[message.topicPath] = Object.create(null)
    }

    sub[socket.id] = (sub[socket.id] || 0) + 1
    socketSub[message.topicPath] = (socketSub[message.topicPath] || 0) + 1
  }
}

NydusServer.prototype._onUnsubscribe = function(socket, message) {
  var self = this
    , sub = self._subscriptions[message.topicPath]
    , socketSub = self._socketSubs[socket.id]
  if (!sub || !sub[socket.id]) {
    socket.sendError(message.requestId, 400, 'bad request', 'no subscriptions exist for this topic')
    return
  }

  sub[socket.id]--
  socketSub[message.topicPath]--
  if (!sub[socket.id]) {
    delete sub[socket.id]
    delete socketSub[message.topicPath]
  }

  socket.sendResult(message.requestId)
}

NydusServer.prototype._onPublish = function(socket, message) {
  var self = this
    , route = this.router.matchPublish(message.topicPath)
  if (!route) {
    return socket.sendError(message.requestId, 404, 'not found',
        { message: message.topicPath + ' could not be found' })
  }

  var req = createReq(socket, message.requestId, route, message.topicPath)
    , args = [ req, message.event, complete ]

  route.fn.apply(this, args)

  function complete(event) {
    var socketIds = Object.keys(self._subscriptions[message.topicPath] || {})
    if (!socketIds.length) {
      return
    }
    var sockets = socketIds.map(function(id) {
      return self._sockets[id]
    })

    if (message.excludeMe) {
      var index = sockets.indexOf(socket);
      if (index != -1) {
        sockets.splice(index, 1)
      }
    }

    Socket.sendEventToAll(sockets, message.topicPath, event)
  }
}

NydusServer.prototype._sendPing = function(socket) {
  delete this._pingIntervals[socket.id]

  var self = this
  this._pingTimeouts[socket.id] = setTimeout(function() {
    socket.terminate()
  }, this._options.pingTimeout)

  socket.call('/_/ping', function(err) {
    if (err) {
      socket.terminate()
      return
    }

    clearTimeout(self._pingTimeouts[socket.id])
    delete self._pingTimeouts[socket.id]

    self._startPingInterval(socket)
  })
}

NydusServer.prototype._startPingInterval = function(socket) {
  var self = this
  this._pingIntervals[socket.id] = setTimeout(function() {
    self._sendPing(socket)
  }, this._options.pingInterval)
}

function createReq(socket, requestId, route, path) {
  return  { socket: socket
          , requestId: requestId
          , route: route.route
          , params: route.params
          , splats: route.splats
          , path: path
          }
}

function createRes(server, socket, requestId, cb) {
  var sent = false

  function complete(results) {
    if (sent) {
      server.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    cb(false)
    var args = Array.prototype.slice.apply(arguments)
    socket.sendResult(requestId, args)
    sent = true
  }

  function fail(errorCode, errorDesc, errorDetails) {
    if (sent) {
      server.emit('error', new Error('Only one response can be sent for a CALL.'))
      return
    }
    cb(true)
    socket.sendError(requestId, errorCode, errorDesc, errorDetails)
    sent = true
  }

  return { complete: complete, fail: fail }
}
