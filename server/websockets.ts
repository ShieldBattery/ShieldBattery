import cuid from 'cuid'
import fs from 'fs'
import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http'
import Koa from 'koa'
import { NydusServer, NydusServerOptions } from 'nydus'
import path from 'path'
import { container, inject, instanceCachingFactory, singleton } from 'tsyringe'
import log from './lib/logging/logger'
import { isElectronClient } from './lib/network/electron-clients'
import { getSingleQueryParam } from './lib/network/query-param'
import { CORS_MAX_AGE_SECONDS } from './lib/security/cors'
import { StateWithJwt } from './lib/session/jwt-session-middleware'
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
    @inject('jwtMiddleware') private jwtMiddleware: Koa.Middleware,
    @inject('sessionMiddleware') private sessionMiddleware: Koa.Middleware,
    private sessionLookup: RequestSessionLookup,
    readonly clientSockets: ClientSocketsManager,
    readonly userSockets: UserSocketsManager,
  ) {
    ;(this.nydus as AuthorizingNydusServer).setAllowRequestHandler((req, cb) => {
      this.onAuthorization(req, cb).catch(err => {
        log.error({ err }, 'Error during socket authorization')
      })
    })

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
  }

  async onAuthorization(
    req: IncomingMessage,
    cb: (err: Error | null, authorized?: boolean) => void,
  ) {
    const logger = log.child({ reqId: cuid() })
    logger.info({ req }, 'websocket authorizing')

    const ctx = this.koa.createContext<StateWithJwt>(req, dummyRes)
    const jwtMiddleware = this.jwtMiddleware
    const sessionMiddleware = this.sessionMiddleware
    try {
      await jwtMiddleware(ctx, async () => {})
      await sessionMiddleware(ctx, async () => {})

      if (!ctx.session || !ctx.state.jwtData) {
        // User is not logged in
        cb(null, false)
        return
      }

      const clientId = getSingleQueryParam(ctx.query.clientId) ?? cuid()
      const handshakeData: SessionInfo = {
        sessionId: ctx.state.jwtData.sessionId,
        userId: ctx.session.user.id,
        clientId,
        userName: ctx.session.user.name,
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
