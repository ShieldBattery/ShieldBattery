import nydus from 'nydus'
import path from 'path'
import fs from 'fs'
import cuid from 'cuid'
import getAddress from './lib/websockets/get-address'
import { createUserSockets, createClientSockets } from './lib/websockets/socket-groups'
import log from './lib/logging/logger'
import matchmakingStatusInstance from './lib/matchmaking/matchmaking-status-instance'

const apiHandlers = fs
  .readdirSync(path.join(__dirname, 'lib', 'wsapi'))
  .filter(filename => /\.(js|ts)$/.test(filename))
  .map(filename => require('./lib/wsapi/' + filename).default)

// dummy response object, needed for session middleware's cookie setting stuff
const dummyRes = {
  getHeader() {},
  setHeader() {},
}

class WebsocketServer {
  constructor(server, koaApp, sessionMiddleware) {
    this.httpServer = server
    this.koa = koaApp
    this.sessionWare = sessionMiddleware
    this.sessionLookup = new WeakMap()

    this.connectedUsers = 0
    this.nydus = nydus(this.httpServer, {
      allowRequest: async (info, cb) => await this.onAuthorization(info, cb),
    })

    // NOTE(tec27): the order of creation here is very important, we want *more specific* event
    // handlers on sockets registered first, so that their close handlers get called first.
    this.clientSockets = createClientSockets(this.nydus, this.sessionLookup)
    this.userSockets = createUserSockets(this.nydus, this.sessionLookup)

    for (const handler of apiHandlers) {
      if (handler) {
        handler(this.nydus, this.userSockets, this.clientSockets)
      }
    }

    this.userSockets
      .on('newUser', () => this.connectedUsers++)
      .on('userQuit', () => this.connectedUsers--)

    this.nydus.on('connection', socket => {
      this.nydus.subscribeClient(socket, '/status', { users: this.connectedUsers })

      // TODO(2Pac): Only do this for Electron clients
      if (matchmakingStatusInstance) {
        matchmakingStatusInstance.subscribe(socket)
      }
    })

    // TODO(tec27): this timer can be longer (like 5 minutes) but is shorter for demo purposes
    setInterval(() => this.nydus.publish('/status', { users: this.connectedUsers }), 1 * 60 * 1000)
  }

  async onAuthorization(req, cb) {
    const logger = log.child({ reqId: cuid() })
    logger.info({ req }, 'websocket authorizing')
    if (!req.headers.cookie) {
      logger.error({ err: new Error('request had no cookies') }, 'websocket error')
      cb(null, false)
      return
    }

    const ctx = this.koa.createContext(req, dummyRes)
    const sessionWare = this.sessionWare
    try {
      await sessionWare(ctx, () => {})

      if (!ctx.session.userId) {
        throw new Error('User is not logged in')
      }

      const clientId = ctx.query.clientId || cuid()
      const handshakeData = {
        sessionId: ctx.sessionId,
        userId: ctx.session.userId,
        clientId,
        userName: ctx.session.userName,
        address: getAddress(req),
      }
      this.sessionLookup.set(req, handshakeData)
      cb(null, true)
    } catch (err) {
      logger.error({ err }, 'websocket error')
      cb(null, false)
    }
  }
}

export default function (server, koaApp, sessionMiddleware) {
  return new WebsocketServer(server, koaApp, sessionMiddleware)
}
