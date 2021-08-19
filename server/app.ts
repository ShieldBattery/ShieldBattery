import { RouterContext } from '@koa/router'
import 'core-js/proposals/reflect-metadata'
import http from 'http'
import Koa from 'koa'
import koaBody from 'koa-body'
import koaCompress from 'koa-compress'
import koaConvert from 'koa-convert'
import views from 'koa-views'
import path from 'path'
import { container } from 'tsyringe'
import isDev from './lib/env/is-dev'
import { errorPayloadMiddleware } from './lib/errors/error-payload-middleware'
import { addMiddleware as fileStoreMiddleware, setStore } from './lib/file-upload'
import AwsStore from './lib/file-upload/aws'
import LocalFileStore from './lib/file-upload/local-filesystem'
import { requestContainerCreator } from './lib/http/request-container-middleware'
import logMiddleware from './lib/logging/log-middleware'
import log from './lib/logging/logger'
import userIpsMiddleware from './lib/network/user-ips-middleware'
import { RallyPointService } from './lib/rally-point/rally-point-service'
import redis from './lib/redis'
import checkOrigin from './lib/security/check-origin'
import { cors } from './lib/security/cors'
import secureHeaders from './lib/security/headers'
import sessionMiddleware from './lib/session/middleware'
import { migrateSessions } from './lib/session/migrate-sessions'
import userSessionsMiddleware from './lib/session/user-sessions-middleware'
import createRoutes from './routes'
import { WebsocketServer } from './websockets'

if (!process.env.SB_CANONICAL_HOST) {
  throw new Error('SB_CANONICAL_HOST must be specified')
}
if (!process.env.SB_RALLY_POINT_SECRET) {
  throw new Error('SB_RALLY_POINT_SECRET must be specified')
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

const app = new Koa()
const port = process.env.SB_HTTP_PORT

container.register<Koa>(Koa, { useValue: app })

let webpackCompiler: any

function getWebpackCompiler() {
  if (!webpackCompiler) {
    const webpack = require('webpack')
    const webpackConfig = require('./webpack.config.js')
    webpackCompiler = webpack(webpackConfig)
  }

  return webpackCompiler
}

app.keys = [process.env.SB_SESSION_SECRET!]
app.proxy = process.env.SB_HTTPS_REVERSE_PROXY === 'true'

interface PossibleHttpError extends Error {
  status?: number
}

app.on('error', (err: PossibleHttpError, ctx?: RouterContext) => {
  if (err.status && err.status < 500) return // likely an HTTP error (expected and fine)

  log.error({ err, req: ctx?.req }, 'server error')
})

process.on('unhandledRejection', err => {
  log.error({ err }, 'unhandled rejection')
  if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
    // These types are very unlikely to be handle-able properly, exit
    throw err
  }
  // Other promise rejections are likely less severe, leave the process up but log it
})

app
  .use(logMiddleware())
  .use(errorPayloadMiddleware())
  .use(
    koaCompress({
      // NOTE(tec27): Brotli is cool and all, but if the asset hasn't been precompressed and saved
      // out there's almost zero way that compressing it with brotli during the request is going to
      // be faster than just sending a slightly bigger gzipped version
      br: false,
    }),
  )
  .use(views(path.join(__dirname, 'views'), { extension: 'jade' }))
  .use(checkOrigin(process.env.SB_CANONICAL_HOST))
  .use(koaBody())
  .use(sessionMiddleware)
  .use(migrateSessions())
  .use(cors())
  .use(secureHeaders())
  .use(userIpsMiddleware())
  .use(userSessionsMiddleware())
  .use(requestContainerCreator())

const mainServer = http.createServer(app.callback())
container.register<Koa.Middleware>('sessionMiddleware', { useValue: sessionMiddleware })
container.register<http.Server>(http.Server, { useValue: mainServer })

const websocketServer = container.resolve(WebsocketServer)

const routeCreatorConfig = {
  host: process.env.SB_ROUTE_CREATOR_HOST || '::',
  port: Number(process.env.SB_ROUTE_CREATOR_PORT || 0),
}
const rallyPointService = container.resolve(RallyPointService)
const rallyPointInitPromise = rallyPointService.initialize(
  routeCreatorConfig.host,
  routeCreatorConfig.port,
  process.env.SB_RALLY_POINT_SECRET,
)

// Wrapping this in IIFE so we can use top-level `await` (until we move to ESM and can use it
// natively)
;(async () => {
  if (isDev) {
    const { webpackMiddleware } = require('./lib/webpack/middleware')
    const koaWebpackHot = require('koa-webpack-hot-middleware')

    app.use(
      webpackMiddleware({
        compiler: getWebpackCompiler(),
        devMiddleware: {
          publicPath: require('./webpack.config.js').output.publicPath,
        },
      }),
    )
    app.use(koaConvert(koaWebpackHot(getWebpackCompiler())))
  }

  log.info('Testing connection to redis.')
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

  fileStoreMiddleware(app)

  createRoutes(app, websocketServer)

  const needToBuild = !(isDev || process.env.SB_PREBUILT_ASSETS)
  const compilePromise = needToBuild
    ? new Promise((resolve, reject) =>
        getWebpackCompiler().run((err: Error, stats: any) => (err ? reject(err) : resolve(stats))),
      )
    : Promise.resolve()
  if (needToBuild) {
    log.info('In production mode, building assets...')
  }

  try {
    await rallyPointInitPromise

    const stats: any | undefined = await compilePromise

    if (stats) {
      if ((stats.errors && stats.errors.length) || (stats.warnings && stats.warnings.length)) {
        throw new Error(stats.toString())
      }

      const statStr = stats.toString({ colors: true })
      log.info(`Webpack stats:\n${statStr}`)
    }

    mainServer.listen(port, function () {
      log.info('Server listening on port ' + port)
    })
  } catch (err) {
    log.error({ err }, 'Error building assets')
    process.exit(1)
  }
})().catch(err => {
  log.error({ err }, 'Error initializing app')
  process.exit(1)
})
