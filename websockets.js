var sio = require('socket.io')

module.exports = function(server, cookieParser, sessionMiddleware) {
  return new WebsocketServer(server, cookieParser, sessionMiddleware)
}

function WebsocketServer(server, cookieParser, sessionMiddleware) {
  this.httpServer = server
  this.cookieParser = cookieParser
  this.sessionWare = sessionMiddleware
  this.io = sio.listen(server, { secure: true })

  var self = this
  this.io.configure(function() {
    self.io.set('transports', ['websocket'])
      .enable('browser client minification')
      .enable('browser client etag')

    self.io.set('authorization', self.onAuthorization.bind(self))
  })

  this.io.on('connection', function(socket) {
    socket.emit('hello', socket.handshake.userId)
  })
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
      cb(null, true)
    })
  })
}
