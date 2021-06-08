import cuid from 'cuid'
import fs from 'fs'
import { IncomingMessage, Server as HttpServer, ServerResponse } from 'http'
import Koa from 'koa'
import { NydusServer, NydusServerOptions } from 'nydus'
import path from 'path'
import { container, inject, instanceCachingFactory, singleton } from 'tsyringe'
import log from './lib/logging/logger'
import matchmakingStatusInstance from './lib/matchmaking/matchmaking-status-instance'
import { isElectronClient } from './lib/network/only-web-clients'
import { getSingleQueryParam } from './lib/network/query-param'
import { CORS_MAX_AGE_SECONDS } from './lib/security/cors'
import getAddress from './lib/websockets/get-address'
import { RequestSessionLookup, SessionInfo } from './lib/websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from './lib/websockets/socket-groups'

const apiHandlers = fs
  .readdirSync(path.join(__dirname, 'lib', 'wsapi'))
  .filter(filename => /\.(js|ts)$/.test(filename))
  .map(filename => require('./lib/wsapi/' + filename).default)

// dummy response object, needed for session middleware's cookie setting stuff
const dummyRes = {
  getHeader: () => undefined,
  setHeader() {},
} as any as ServerResponse

type AllowRequestFn = (
  req: IncomingMessage,
  cb: (err: Error | null, authorized?: boolean) => void,
) => void

class AuthorizingNydusServer extends NydusServer {
  private allowRequest: AllowRequestFn | undefined

  constructor(options: Partial<NydusServerOptions> = {}) {
    super({
      ...options,
      allowRequest: (req: IncomingMessage, cb: (err: Error | null, authorized?: boolean) => void) =>
        this.onAllowRequest(req, cb),
    } as any as Partial<NydusServerOptions>)
  }

  setAllowRequestHandler(fn: AllowRequestFn) {
    this.allowRequest = fn
  }

  private onAllowRequest(
    req: IncomingMessage,
    cb: (err: Error | null, authorized?: boolean) => void,
  ) {
    if (this.allowRequest) {
      this.allowRequest(req, cb)
    } else {
      cb(new Error('authorization not configured'), false)
    }
  }
}

@singleton()
export class WebsocketServer {
  private connectedUsers = 0

  constructor(
    private koa: Koa,
    readonly nydus: NydusServer,
    @inject('sessionMiddleware') private sessionMiddleware: Koa.Middleware,
    private sessionLookup: RequestSessionLookup,
    readonly clientSockets: ClientSocketsManager,
    readonly userSockets: UserSocketsManager,
  ) {
    ;(this.nydus as AuthorizingNydusServer).setAllowRequestHandler((req, cb) =>
      this.onAuthorization(req, cb).catch(err => {
        log.error({ err }, 'Error during socket authorization')
      }),
    )

    this.nydus
      .on('error', err => {
        log.error({ err }, 'nydus error')
      })
      .on('invokeError', (err, client, msg) => {
        log.error({ err }, `client ${client.id} triggered a server error on path ${msg.path}`)
      })
      .on('parserError', (client, msg) => {
        log.error(`client ${client.id} send a message that was unparseable: ${msg}`)
      })

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

      const sessionInfo = this.sessionLookup.fromSocket(socket)
      if (sessionInfo?.clientType === 'electron') {
        if (matchmakingStatusInstance) {
          matchmakingStatusInstance.subscribe(socket)
        }
      }
    })

    let lastConnectedUsers = 0
    setInterval(() => {
      if (this.connectedUsers !== lastConnectedUsers) {
        lastConnectedUsers = this.connectedUsers
        this.nydus.publish('/status', { users: lastConnectedUsers })
      }
    }, 1 * 60 * 1000)
  }

  async onAuthorization(
    req: IncomingMessage,
    cb: (err: Error | null, authorized?: boolean) => void,
  ) {
    const logger = log.child({ reqId: cuid() })
    logger.info({ req }, 'websocket authorizing')
    if (!req.headers.cookie) {
      logger.error({ req, err: new Error('request had no cookies') }, 'websocket error')
      cb(null, false)
      return
    }

    const ctx = this.koa.createContext(req, dummyRes)
    const sessionMiddleware = this.sessionMiddleware
    try {
      await sessionMiddleware(ctx, async () => {})

      if (!ctx.session?.userId) {
        // User is not logged in
        cb(null, false)
        return
      }

      const clientId = getSingleQueryParam(ctx.query.clientId) ?? cuid()
      const handshakeData: SessionInfo = {
        sessionId: ctx.sessionId,
        userId: ctx.session.userId,
        clientId,
        userName: ctx.session.userName,
        address: getAddress(req),
        clientType: isElectronClient(ctx) ? 'electron' : 'web',
      }
      this.sessionLookup.set(req, handshakeData)
      cb(null, true)
    } catch (err) {
      logger.error({ req, err }, 'websocket error')
      cb(null, false)
    }
  }
}

container.register<NydusServer>(NydusServer, {
  useFactory: instanceCachingFactory(c => {
    const httpServer = c.resolve(HttpServer)
    const opts = {
      cors: {
        origin: 'shieldbattery://app',
        credentials: true,
        maxAge: CORS_MAX_AGE_SECONDS,
      },

      pingTimeout: 20000,
      pingInterval: 25000,
      upgradeTimeout: 10000,
      // TODO(tec27): remove these casts once the engine.io typings actually include the CORS stuff
    } as any as Partial<NydusServerOptions>
    const nydus = new AuthorizingNydusServer(opts)
    nydus.attach(httpServer, opts)
    return nydus
  }),
})
