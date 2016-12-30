import nydus from 'nydus'
import path from 'path'
import fs from 'fs'
import co from 'co'
import uid from 'cuid'
import getAddress from './lib/websockets/get-address'
import createUserSockets from './lib/websockets/user-sockets'
import log from './lib/logging/logger'
import config from './config'

const apiHandlers =
  fs.readdirSync(path.join(__dirname, 'lib', 'wsapi'))
  .filter(filename => /\.js$/.test(filename))
  .map(filename => require('./lib/wsapi/' + filename).default)

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
    this.sessionLookup = new WeakMap()

    this.connectedUsers = 0
    this.nydus = nydus(this.httpServer, {
      allowRequest: (info, cb) => this.onAuthorization(info, cb)
    })
    this.userSockets = createUserSockets(this.nydus, this.sessionLookup)

    for (const handler of apiHandlers) {
      handler(this.nydus, this.userSockets)
    }

    this.userSockets
      .on('newUser', () => this.connectedUsers++)
      .on('userQuit', () => this.connectedUsers--)

    const minVersion = config.minPsiVersion || '0.0.0'
    const installerUrl = config.installerUrl
    this.nydus.on('connection', socket => {
      this.nydus.subscribeClient(socket, '/status', { users: this.connectedUsers })
      this.nydus.subscribeClient(socket, '/psiVersion', { minVersion, installerUrl })
    })

    // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
    setInterval(() => this.nydus.publish('/status', { users: this.connectedUsers }), 1 * 60 * 1000)
  }

  onAuthorization(req, cb) {
    const logger = log.child({ reqId: uid() })
    logger.info({ req }, 'websocket authorizing')
    if (!req.headers.cookie) {
      logger.error({ err: new Error('request had no cookies') }, 'websocket error')
      cb(null, false)
      return
    }

    const koaContext = this.koa.createContext(req, dummyRes)
    const sessionWare = this.sessionWare
    co(function* () {
      yield* sessionWare.call(koaContext, (function* () {})())
      return koaContext
    }).then(ctx => {
      if (!ctx.session.userId) {
        throw new Error('User is not logged in')
      }

      const handshakeData = {
        sessionId: ctx.sessionId,
        userId: ctx.session.userId,
        userName: ctx.session.userName,
        address: getAddress(req),
      }
      this.sessionLookup.set(req, handshakeData)
      cb(null, true)
    }).catch(err => {
      logger.error({ err }, 'websocket error')
      cb(null, false)
    })
  }
}

export default function(server, koaApp, sessionMiddleware) {
  return new WebsocketServer(server, koaApp, sessionMiddleware)
}
