var nydus = require('nydus')
  , path = require('path')
  , fs = require('fs')
  , createUserSockets = require('./util/user-sockets')

module.exports = function(server, cookieParser, sessionMiddleware) {
  return new WebsocketServer(server, cookieParser, sessionMiddleware)
}

var apiHandlers = []
  , jsFileMatcher = RegExp.prototype.test.bind(/\.js$/)
fs.readdirSync(path.join(__dirname, 'wsapi')).filter(jsFileMatcher).forEach(function(filename) {
  apiHandlers.push(require('./wsapi/' + filename))
})

function WebsocketServer(server, cookieParser, sessionMiddleware) {
  var self = this
  this.httpServer = server
  this.cookieParser = cookieParser
  this.sessionWare = sessionMiddleware

  function authorize(info, cb) {
    self.onAuthorization(info, cb)
  }

  this.nydus = nydus(server, { authorize: authorize })
  this.userSockets = createUserSockets(this.nydus)
  this.connectedUsers = 0

  apiHandlers.forEach(function(handler) {
    handler(self.nydus, self.userSockets)
  })

  this.userSockets.on('newUser', function(user) {
    self.connectedUsers++
  }).on('userQuit', function(userName) {
    self.connectedUsers--
  })

  self.nydus.router.subscribe('/status', function(req, res) {
    res.complete()
    req.socket.publish('/status', { users: self.connectedUsers })
  })

  setInterval(function() {
    self.nydus.publish('/status', { users: self.connectedUsers })
  }, 1*60*1000)
  // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
}

var dummyRes = { on: function() {} }
WebsocketServer.prototype.onAuthorization = function(data, cb) {
  // TODO(tec27): log this stuff to bunyan
  var req = data.req
  if (!req.headers.cookie) {
    return cb(false)
  }

  var self = this
    , parserData = { headers: req.headers }
  this.cookieParser(parserData, {}, function(err) {
    if (err) return cb(false)

    parserData.originalUrl = req.url // necessary for session middleware
    self.sessionWare(parserData, dummyRes, function(err) {
      delete dummyRes.end
      if (err || !parserData.session || !parserData.session.userId) {
        return cb(false)
      }
      var handshakeData = { sessionId: parserData.sessionID
                          , userId: parserData.session.userId
                          , userName: parserData.session.userName
                          , address: req.connection.remoteAddress
                          }
      cb(true, handshakeData)
    })
  })
}
