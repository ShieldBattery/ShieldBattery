import './env'

import { RouterContext } from '@koa/router'
import { promises as fsPromises } from 'fs'
import http from 'http'
import Koa from 'koa'
import koaBody from 'koa-body'
import koaCompress from 'koa-compress'
import koaJwt from 'koa-jwt'
import { container } from 'tsyringe'
import { DISCORD_WEBHOOK_URL_TOKEN } from './lib/discord/webhook-notifier'
import isDev from './lib/env/is-dev'
import { errorPayloadMiddleware } from './lib/errors/error-payload-middleware'
import { addMiddleware as fileStoreMiddleware, setStore } from './lib/files'
import AwsStore from './lib/files/aws'
import LocalFileStore from './lib/files/local-filesystem'
import { GameServerRegionsService } from './lib/game-server-regions/game-server-regions-service'
import logMiddleware from './lib/logging/log-middleware'
import log from './lib/logging/logger'
import { updateEmailTemplates } from './lib/mail/update-templates'
import { prometheusHttpMetrics, prometheusMiddleware } from './lib/monitoring/prometheus-middleware'
import { redirectToCanonical } from './lib/network/redirect-to-canonical'
import userIpsMiddleware from './lib/network/user-ips-middleware'
import { Redis } from './lib/redis/redis'
import checkOrigin from './lib/security/check-origin'
import { cors } from './lib/security/cors'
import secureHeaders from './lib/security/headers'
import { StateWithJwt, jwtSessions } from './lib/session/jwt-session-middleware'
import createRoutes from './routes'
import { createWebhookRoutes } from './webhook-routes'
import { WebsocketServer } from './websockets'

if (!process.env.SB_GQL_ORIGIN) {
  throw new Error('SB_GQL_ORIGIN must be specified')
}
if (!process.env.SB_CANONICAL_HOST) {
  throw new Error('SB_CANONICAL_HOST must be specified')
}
if (!process.env.SB_JWT_SECRET) {
  throw new Error('SB_JWT_SECRET must be specified')
}
if (!process.env.SB_SERVER_RS_URL) {
  throw new Error('SB_SERVER_RS_URL must be specified')
}

if (!process.env.SB_FILE_STORE) {
  throw new Error('SB_FILE_STORE must be specified')
}
const fileStoreSettings = JSON.parse(process.env.SB_FILE_STORE)
if (!fileStoreSettings) {
  throw new Error('SB_FILE_STORE is invalid')
}
if (fileStoreSettings.filesystem) {
  const settings = fileStoreSettings.filesystem
  if (!settings || !settings.path) {
    throw new Error('Invalid "filesystem" store settings')
  }
  setStore(new LocalFileStore(settings))
} else if (fileStoreSettings.doSpaces) {
  const settings = fileStoreSettings.doSpaces
  if (
    !settings ||
    !settings.endpoint ||
    !settings.accessKeyId ||
    !settings.secretAccessKey ||
    !settings.bucket
  ) {
    throw new Error('Invalid "doSpaces" store settings')
  }
  setStore(new AwsStore(settings))
} else {
  throw new Error('no valid key could be found in SB_FILE_STORE')
}

container.register(DISCORD_WEBHOOK_URL_TOKEN, {
  useValue: process.env.SB_DISCORD_WEBHOOK_URL ?? '',
})

const app = new Koa()
const port = process.env.SB_HTTP_PORT

container.register<Koa>(Koa, { useValue: app })

app.proxy = process.env.SB_HTTPS_REVERSE_PROXY === 'true'

interface PossibleHttpError extends Error {
  status?: number
}

interface PossibleNodeError extends Error {
  code?: string
}

app.on('error', (err: PossibleHttpError & PossibleNodeError, ctx?: RouterContext) => {
  if (err.status && err.status < 500) return // likely an HTTP error (expected and fine)

  if (
    err.code &&
    (err.code === 'ECONNRESET' || err.code === 'EPIPE' || err.code === 'ERR_STREAM_PREMATURE_CLOSE')
  ) {
    // These all mean the client disconnected while we were still sending a response (the stream
    // variant occurs when the body is piped through stream.pipeline). They aren't severe or even
    // really fixable (AFAIK), but still may be useful to log in case they start happening for
    // things we don't expect
    log.warn({ err, req: ctx?.req }, 'server error (non-severe)')
  } else {
    log.error({ err, req: ctx?.req, cause: (err as any)?.cause }, 'server error')
  }
})

const jwtMiddleware = koaJwt({
  secret: process.env.SB_JWT_SECRET,
  passthrough: true,
  key: 'jwtData',
})
const jwtSessionMiddleware = jwtSessions()

const unhandledRejections = new Set<Promise<any>>()
process
  .on('unhandledRejection', (err, promise) => {
    unhandledRejections.add(promise)
    setTimeout(() => {
      if (!unhandledRejections.delete(promise)) {
        return
      }

      log.error({ err }, 'rejection unhandled after 1 second')
      if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
        // These types are very unlikely to be handle-able properly, exit
        throw err
      }
      // Other promise rejections are likely less severe, leave the process up but log it
    }, 1000)
  })
  .on('rejectionHandled', promise => {
    unhandledRejections.delete(promise)
  })

const webhookRoutes = createWebhookRoutes()

app
  .use(prometheusMiddleware())
  .use(prometheusHttpMetrics())
  .use(logMiddleware())
  .use(errorPayloadMiddleware())
  // Webhook routes are mounted here, ahead of CSRF/origin checks, cookie/JWT session handling,
  // CORS, security headers, and static file serving: their callers are trusted external services
  // authenticating with their own bearer secrets, not browsers, so that machinery doesn't apply.
  // See webhook-routes.ts.
  .use(webhookRoutes.routes())
  .use(webhookRoutes.allowedMethods())
  .use(
    koaCompress({
      // NOTE(tec27): Brotli is cool and all, but if the asset hasn't been precompressed and saved
      // out there's almost zero way that compressing it with brotli during the request is going to
      // be faster than just sending a slightly bigger gzipped version
      br: false,
    }),
  )
  .use(redirectToCanonical(process.env.SB_CANONICAL_HOST))
  .use(checkOrigin(process.env.SB_CANONICAL_HOST))
  .use(koaBody())
  .use(jwtMiddleware)
  .use(jwtSessionMiddleware)
  .use(cors())
  .use(secureHeaders())
  .use(userIpsMiddleware())

const serverCallback = app.callback()
const mainServer = http.createServer((req, res) => {
  // We want our unhandledRejection handler to be useful, so we don't want to deal with promises
  // at this root level. If a rejection were caught here, it'd indicate a problem at a deeper level
  // anyway.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  serverCallback(req, res)
})
container.register<Koa.Middleware>('jwtMiddleware', {
  useValue: jwtMiddleware,
})
container.register<Koa.Middleware<StateWithJwt>>('sessionMiddleware', {
  useValue: jwtSessionMiddleware,
})
container.register<http.Server>(http.Server, { useValue: mainServer })

// Resolved (not stored) here only so its constructor wires up nydus/socket handling before any
// client connects; nothing else in this module needs the instance.
container.resolve(WebsocketServer)

// Resolved (not initialized) here only so its constructor registers the electron client
// subscription before any client connects. Fetching the region list itself is demand-driven and
// deliberately untouched by server startup -- see the class doc comment.
container.resolve(GameServerRegionsService)

// Wrapping this in IIFE so we can use top-level `await` (until we move to ESM and can use it
// natively)
;(async () => {
  if (!isDev) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error('GOOGLE_APPLICATION_CREDENTIALS must be specified')
    } else {
      try {
        await fsPromises.access(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      } catch (err) {
        throw new Error(
          'GOOGLE_APPLICATION_CREDENTIALS points to an invalid file: ' +
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
          { cause: err },
        )
      }
    }
  }

  log.info('Testing connection to redis.')
  const redis = container.resolve(Redis)
  try {
    await redis.ping()
  } catch (err) {
    log.error(
      { err },
      'Could not connect to Redis instance, redis host/port configuration may be incorrect',
    )
    process.exit(1)
  }

  redis.on('error', err => {
    log.error({ err }, 'redis error')
  })

  try {
    await updateEmailTemplates()
  } catch (err: any) {
    log.error(
      {
        err,
        request: err.request
          ? { url: err.request.options.url, method: err.request.options.method }
          : undefined,
        body: err.response?.body,
      },
      'Error updating email templates',
    )
    process.exit(1)
  }

  fileStoreMiddleware(app)

  if (isDev) {
    // Attached before the routes so that requests for client modules reach Vite rather than the
    // catch-all that renders the shell. The specifier is assembled at runtime so the compiler
    // leaves this require inside the condition: statically analyzable requires get hoisted into
    // unconditional module imports, and Vite is development-only and absent from production
    // installs.
    const devOnlyVitePath = './lib/client-shell/vite-dev-server'
    const { attachViteDevServer } = require(devOnlyVitePath)
    await attachViteDevServer(app, mainServer)
  }

  createRoutes(app, process.env.SB_GQL_ORIGIN!)

  mainServer.listen(port, function () {
    log.info('Server listening on port ' + port)
  })
})().catch(err => {
  log.error({ err }, 'Error initializing app')
  process.exit(1)
})
