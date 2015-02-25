var nydus = require('nydus')
  , path = require('path')
  , fs = require('fs')
  , co = require('co')
  , createUserSockets = require('./util/user-sockets')

module.exports = function(server, koaApp, sessionMiddleware) {
  return new WebsocketServer(server, koaApp, sessionMiddleware)
}

var apiHandlers =
  fs.readdirSync(path.join(__dirname, 'wsapi'))
  .filter(filename => /\.js$/.test(filename))
  .map(filename => require('./wsapi/' + filename))

class WebsocketServer {
  constructor(server, koaApp, sessionMiddleware) {
    this.httpServer = server
    this.koa = koaApp
    this.sessionWare = sessionMiddleware

    this.nydus = nydus(server, { authorize: (info, cb) => this.onAuthorization(info, cb) })
    this.userSockets = createUserSockets(this.nydus)
    this.connectedUsers = 0

    apiHandlers.forEach(handler => handler(this.nydus, this.userSockets))

    this.userSockets
      .on('newUser', () => this.connectedUsers++)
      .on('userQuit', () => this.connectedUsers--)

    this.nydus.router.subscribe('/status', (req, res) => {
      res.complete()
      req.socket.publish('/status', { users: this.connectedUsers })
    })

    setInterval(() => this.nydus.publish('/status', { users: this.connectedUsers }), 1*60*1000)
    // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
  }

  onAuthorization(data, cb) {
    // TODO(tec27): log this stuff to bunyan
    var req = data.req
    if (!req.headers.cookie) {
      return cb(false)
    }

    var koaContext = this.koa.createContext(req, {})
      , sessionWare = this.sessionWare
    co(function*() {
      yield* sessionWare.call(koaContext, function*(){})
      return koaContext
    }).then(ctx => {
      if (!ctx.session.userId) {
        throw new Error('User is not logged in')
      }

      var handshakeData = {
        sessionId: ctx.sessionId,
        userId: ctx.session.userId,
        userName: ctx.session.userName,
        address: req.connection.remoteAddress,
      }
      cb(true, handshakeData)
    }).catch(() => {
      cb(false)
    })
  }
}
