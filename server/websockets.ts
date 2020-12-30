import createNydus, { NydusServer, NydusServerOptions } from 'nydus'
import path from 'path'
import fs from 'fs'
import cuid from 'cuid'
import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http'
import Koa from 'koa'

import { RequestSessionLookup, SessionInfo } from './lib/websockets/session-lookup'
import getAddress from './lib/websockets/get-address'
import { ClientSocketsManager, UserSocketsManager } from './lib/websockets/socket-groups'
import log from './lib/logging/logger'
import matchmakingStatusInstance from './lib/matchmaking/matchmaking-status-instance'
import { CORS_MAX_AGE_SECONDS } from './lib/security/cors'

const apiHandlers = fs
  .readdirSync(path.join(__dirname, 'lib', 'wsapi'))
  .filter(filename => /\.(js|ts)$/.test(filename))
  .map(filename => require('./lib/wsapi/' + filename).default)

// dummy response object, needed for session middleware's cookie setting stuff
const dummyRes = ({
  getHeader: () => undefined,
  setHeader() {},
} as any) as ServerResponse

export class WebsocketServer {
  private sessionLookup: RequestSessionLookup = new WeakMap<IncomingMessage, SessionInfo>()
  private connectedUsers = 0

  readonly nydus: NydusServer
  readonly clientSockets: ClientSocketsManager
  readonly userSockets: UserSocketsManager

  constructor(
    private httpServer: HttpServer,
    private koa: Koa,
    private sessionMiddleware: Koa.Middleware,
  ) {
    this.nydus = createNydus(this.httpServer, ({
      allowRequest: (req: IncomingMessage, cb: (err: Error | null, authorized?: boolean) => void) =>
        this.onAuthorization(req, cb).catch(err => {
          log.error({ err }, 'Error during socket authorization')
        }),
      cors: {
        origin: 'shieldbattery://app',
        credentials: true,
        maxAge: CORS_MAX_AGE_SECONDS,
      },
      // TODO(tec27): remove these casts once the engine.io typings actually include the CORS stuff
    } as any) as Partial<NydusServerOptions>)

    this.nydus.on('error', err => {
      log.error({ err }, 'nydus error')
    })

    // NOTE(tec27): the order of creation here is very important, we want *more specific* event
    // handlers on sockets registered first, so that their close handlers get called first.
    this.clientSockets = new ClientSocketsManager(this.nydus, this.sessionLookup)
    this.userSockets = new UserSocketsManager(this.nydus, this.sessionLookup)

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

  async onAuthorization(
    req: IncomingMessage,
    cb: (err: Error | null, authorized?: boolean) => void,
  ) {
    const logger = log.child({ reqId: cuid() })
    logger.info({ req }, 'websocket authorizing')
    if (!req.headers.cookie) {
      logger.error({ err: new Error('request had no cookies') }, 'websocket error')
      cb(null, false)
      return
    }

    const ctx = this.koa.createContext(req, dummyRes)
    const sessionMiddleware = this.sessionMiddleware
    try {
      await sessionMiddleware(ctx, async () => {})

      if (!ctx.session?.userId) {
        throw new Error('User is not logged in')
      }

      const clientId = ctx.query.clientId || cuid()
      const handshakeData: SessionInfo = {
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
