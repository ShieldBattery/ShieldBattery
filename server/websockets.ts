import { Server as HttpServer, IncomingMessage, ServerResponse } from 'http'
import Koa from 'koa'
import { nanoid } from 'nanoid'
import { NydusServer, NydusServerOptions } from 'nydus'
import { Counter, Gauge } from 'prom-client'
import { container, inject, instanceCachingFactory, singleton } from 'tsyringe'
import registerLobbySocketApi from './lib/lobbies/lobby-socket-api'
import log from './lib/logging/logger'
import { isElectronClient } from './lib/network/electron-clients'
import { getSingleQueryParam } from './lib/network/query-param'
import { CORS_MAX_AGE_SECONDS } from './lib/security/cors'
import { StateWithJwt } from './lib/session/jwt-session-middleware'
import getAddress from './lib/websockets/get-address'
import { RequestSessionLookup, SessionInfo } from './lib/websockets/session-lookup'
import { ClientSocketsManager, UserSocketsManager } from './lib/websockets/socket-groups'

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
  private websocketConnectionsTotalMetric = new Counter({
    name: 'shieldbattery_websocket_connections_total',
    labelNames: ['result'],
    help: 'Total number of websocket connection authorization attempts, by result',
  })
  private connectedUsersMetric = new Gauge({
    name: 'shieldbattery_connected_users',
    help: 'Current number of distinct users with at least one live websocket connection',
    collect: () => {
      this.connectedUsersMetric.set(this.userSockets.users.size)
    },
  })
  private connectedClientsMetric = new Gauge({
    name: 'shieldbattery_connected_clients',
    help: 'Current number of distinct websocket clients (e.g. browser tabs or app instances)',
    collect: () => {
      this.connectedClientsMetric.set(this.clientSockets.clients.size)
    },
  })

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

    registerLobbySocketApi(this.nydus, this.userSockets, this.clientSockets)
  }

  async onAuthorization(
    req: IncomingMessage,
    cb: (err: Error | null, authorized?: boolean) => void,
  ) {
    const logger = log.child({ reqId: nanoid() })

    const ctx = this.koa.createContext<StateWithJwt>(req, dummyRes)
    const jwtMiddleware = this.jwtMiddleware
    const sessionMiddleware = this.sessionMiddleware
    try {
      await jwtMiddleware(ctx, async () => {})
      await sessionMiddleware(ctx, async () => {})

      if (!ctx.session || !ctx.state.jwtData) {
        // User is not logged in
        logger.info({ req }, 'user tried to connect to websocket without valid session')
        this.websocketConnectionsTotalMetric.labels('rejected').inc()
        cb(null, false)
        return
      }

      const clientId = getSingleQueryParam(ctx.query.clientId) ?? nanoid()
      const handshakeData: SessionInfo = {
        sessionId: ctx.state.jwtData.sessionId,
        userId: ctx.session.user.id,
        clientId,
        userName: ctx.session.user.name,
        address: getAddress(req)!,
        clientType: isElectronClient(ctx) ? 'electron' : 'web',
      }
      this.sessionLookup.set(req, handshakeData)
      this.websocketConnectionsTotalMetric.labels('accepted').inc()
      cb(null, true)
    } catch (err) {
      logger.error({ req, err }, 'websocket error')
      this.websocketConnectionsTotalMetric.labels('rejected').inc()
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
