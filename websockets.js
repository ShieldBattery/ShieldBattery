var sio = require('socket.io')
  , path = require('path')
  , fs = require('fs')
  , userIo = require('./util/user-io.js')

module.exports = function(server, cookieParser, sessionMiddleware) {
  return new WebsocketServer(server, cookieParser, sessionMiddleware)
}

var apiHandlers = []
  , jsFileMatcher = RegExp.prototype.test.bind(/\.js$/)
fs.readdirSync(path.join(__dirname, 'wsapi')).filter(jsFileMatcher).forEach(function(filename) {
  apiHandlers.push(require('./wsapi/' + filename))
})

function WebsocketServer(server, cookieParser, sessionMiddleware) {
  this.httpServer = server
  this.cookieParser = cookieParser
  this.sessionWare = sessionMiddleware
  this.io = sio.listen(server, { secure: true })
  this.connectedUsers = 0

  userIo(this.io)

  var self = this
  this.io.configure(function() {
    self.io.set('transports', ['websocket'])
      .set('log level', 2)
      .enable('browser client minification')
      .enable('browser client etag')

    self.io.set('authorization', self.onAuthorization.bind(self))
  })

  this.apiHandlers = apiHandlers.map(function(handler) { return handler(self.io) })

  this.io.sockets.on('connection', function(socket) {
    self.connectedUsers++
    socket.emit('status', { users: self.connectedUsers })

    socket.on('disconnect', function() {
      self.connectedUsers--
    })

    self._applyApiHandlers(socket)
  })

  setInterval(function() {
    self.io.sockets.emit('status', { users: self.connectedUsers })
  }, 1*60*1000)
  // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
}

var dummyRes = { on: function() {} }
WebsocketServer.prototype.onAuthorization = function(data, cb) {
  // TODO(tec27): log this stuff to bunyan
  if (data.xdomain) {
    return cb(new Error('Invalid request'))
  }
  if (!data || !data.headers || !data.headers.cookie) {
    return cb(new Error('Invalid cookies'))
  }

  var self = this
    , parserData = { headers: data.headers }
  this.cookieParser(parserData, {}, function(err) {
    if (err) return cb(err)

    parserData.originalUrl = data.url // necessary for session middleware
    self.sessionWare(parserData, dummyRes, function(err) {
      delete dummyRes.end
      if (err || !parserData.session || !parserData.session.userId) {
        return cb(new Error('Not logged in'))
      }
      data.sessionId = parserData.sessionID
      data.userId = parserData.session.userId
      data.userName = parserData.session.userName
      cb(null, true)
    })
  })
}

WebsocketServer.prototype._applyApiHandlers = function(socket) {
  for (var i = 0, len = this.apiHandlers.length; i < len; i++) {
    this.apiHandlers[i].apply(socket)
  }
}
