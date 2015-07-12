import nydus from 'nydus'
import path from 'path'
import fs from 'fs'
import co from 'co'
import uid from 'cuid'
import createUserSockets from './server/websockets/user-sockets'
import log from './server/logging/logger'

const apiHandlers =
  fs.readdirSync(path.join(__dirname, 'server', 'wsapi'))
  .filter(filename => /\.js$/.test(filename))
  .map(filename => require('./server/wsapi/' + filename))

// dummy response object, needed for session middleware's cookie setting stuff
const dummyRes = {
  getHeader() {},
  setHeader() {}
}

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

    // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
    setInterval(() => this.nydus.publish('/status', { users: this.connectedUsers }), 1 * 60 * 1000)
  }

  onAuthorization(data, cb) {
    const req = data.req
    const logger = log.child({ reqId: uid() })
    logger.info({ req }, 'websocket authorizing')
    if (!req.headers.cookie) {
      logger.error({ err: new Error('request had no cookies') }, 'websocket error')
      return cb(false)
    }

    const koaContext = this.koa.createContext(req, dummyRes)
    const sessionWare = this.sessionWare
    co(function*() {
      yield* sessionWare.call(koaContext, (function*() {})())
      return koaContext
    }).then(ctx => {
      if (!ctx.session.userId) {
        throw new Error('User is not logged in')
      }

      const handshakeData = {
        sessionId: ctx.sessionId,
        userId: ctx.session.userId,
        userName: ctx.session.userName,
        address: req.connection.remoteAddress,
      }
      cb(true, handshakeData)
    }).catch(err => {
      logger.error({ err }, 'websocket error')
      cb(false)
    })
  }
}

export default function(server, koaApp, sessionMiddleware) {
  return new WebsocketServer(server, koaApp, sessionMiddleware)
}
