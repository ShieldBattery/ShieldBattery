import childProcess from 'child_process'
import dns from 'dns'
import http from 'http'
import net from 'net'

import isDev from './lib/env/is-dev'
import Koa from 'koa'
import koaConvert from 'koa-convert'
import log from './lib/logging/logger'
import path from 'path'
import thenify from 'thenify'

import Csrf from 'koa-csrf'
import csrfCookie from './lib/security/csrf-cookie'
import onlyWebClients from './lib/network/only-web-clients'
import koaBody from 'koa-body'
import koaCompress from 'koa-compress'
import koaError from 'koa-error'
import logMiddleware from './lib/logging/log-middleware'
import { cors } from './lib/security/cors'
import secureHeaders from './lib/security/headers'
import secureJson from './lib/security/json'
import sessionMiddleware from './lib/session/middleware'
import userIpsMiddleware from './lib/network/user-ips-middleware'
import userSessionsMiddleware from './lib/session/user-sessions-middleware'
import views from 'koa-views'

import pingRegistry from './lib/rally-point/ping-registry'
import routeCreator from './lib/rally-point/route-creator'
import matchmakingStatusInstance from './lib/matchmaking/matchmaking-status-instance'

import { setStore, addMiddleware as fileStoreMiddleware } from './lib/file-upload'
import LocalFileStore from './lib/file-upload/local-filesystem'
import AwsStore from './lib/file-upload/aws'

import setupWebsockets from './websockets'
import createRoutes from './routes'

if (!process.env.SB_CANONICAL_HOST) {
  throw new Error('SB_CANONICAL_HOST must be specified')
}
if (!process.env.SB_RALLY_POINT_SECRET || !process.env.SB_RALLY_POINT_SERVERS) {
  throw new Error('SB_RALLY_POINT_SECRET and SB_RALLY_POINT_SERVERS must be specified')
}
const rallyPointSecret = process.env.SB_RALLY_POINT_SECRET
const rallyPointServers = JSON.parse(process.env.SB_RALLY_POINT_SERVERS)
if (!(rallyPointServers.local || rallyPointServers.remote)) {
  throw new Error('SB_RALLY_POINT_SERVERS is invalid')
}
if (rallyPointServers.local) {
  if (!isDev) {
    throw new Error('local rally-point is only available in development mode')
  }

  if (!net.isIPv6(rallyPointServers.local.address)) {
    throw new Error('local rally-point address must be IPv6-formatted')
  }
  log.info('Creating local rally-point process')
  const rallyPoint = childProcess.fork(
    path.join(__dirname, 'lib', 'rally-point', 'run-local-server.js'),
  )
  rallyPoint
    .on('error', err => {
      log.error('rally-point process error: ' + err)
      process.exit(1)
    })
    .on('exit', (code, signal) => {
      log.error(
        'rally-point process exited unexpectedly with code: ' + code + ', signal: ' + signal,
      )
      process.exit(1)
    })
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

const asyncLookup = thenify(dns.lookup)
const rallyPointServersArray = rallyPointServers.local
  ? [rallyPointServers.local]
  : rallyPointServers.remote
const resolvedRallyPointServers = Promise.all(
  rallyPointServersArray.map(async s => {
    let v6
    try {
      v6 = await asyncLookup(s.address, { family: 6 })
    } catch (err) {
      log.warn('Warning: error looking up ' + s.address + ' for ipv6: ' + err)
    }

    let v4
    try {
      v4 = await asyncLookup(s.address, { family: 4 })
    } catch (err) {
      log.warn('Warning: error looking up ' + s.address + ' for ipv4: ' + err)
    }
    if (v4 && v4[1] === 6 && v6 && v6[0].startsWith('::ffff:')) {
      // v6 is an ipv6-mapped ipv4 address, so swap things around
      v4[0] = v6[0].slice('::ffff:'.length)
      v4[1] = 4
      v6[0] = undefined
    }

    if (!v4 && !v6) {
      throw new Error('Could not resolve ' + s.address)
    }

    return {
      address4: v4 && v4[1] === 4 ? `::ffff:${v4[0]}` : undefined,
      address6: v6 && v6[1] === 6 ? v6[0] : undefined,
      port: s.port,
      desc: s.desc,
    }
  }),
)

const routeCreatorConfig = {
  host: process.env.SB_ROUTE_CREATOR_HOST || '::',
  port: Number(process.env.SB_ROUTE_CREATOR_PORT || 0),
}
const initRouteCreatorPromise = routeCreator.initialize(
  routeCreatorConfig.host,
  routeCreatorConfig.port,
  rallyPointSecret,
)

const app = new Koa()
const port = process.env.SB_HTTP_PORT

let webpackCompiler

function getWebpackCompiler() {
  if (!webpackCompiler) {
    const webpack = require('webpack')
    const webpackConfig = require('./webpack.config.js')
    webpackCompiler = webpack(webpackConfig)
  }

  return webpackCompiler
}

app.keys = [process.env.SB_SESSION_SECRET]
app.proxy = process.env.SB_HTTPS_REVERSE_PROXY === 'true'

app.on('error', err => {
  if (err.status && err.status < 500) return // likely an HTTP error (expected and fine)

  log.error({ err }, 'server error')
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
  .use(koaError()) // TODO(tec27): Customize error view
  .use(
    koaCompress({
      // NOTE(tec27): Brotli is cool and all, but if the asset hasn't been precompressed and saved
      // out there's almost zero way that compressing it with brotli during the request is going to
      // be faster than just sending a slightly bigger gzipped version
      br: false,
    }),
  )
  .use(views(path.join(__dirname, 'views'), { extension: 'jade' }))
  .use(koaBody())
  .use(sessionMiddleware)
  .use(cors())
  .use(onlyWebClients(csrfCookie()))
  .use(onlyWebClients(new Csrf()))
  .use(secureHeaders())
  .use(secureJson())
  .use(userIpsMiddleware())
  .use(userSessionsMiddleware())

const mainServer = http.createServer(app.callback())

const { nydus, userSockets } = setupWebsockets(mainServer, app, sessionMiddleware)

matchmakingStatusInstance?.initialize(nydus)

// Wrapping this in IIFE so we can use top-level `await` (until node implements it natively)
;(async () => {
  if (isDev) {
    const koaWebpack = require('koa-webpack')
    const koaWebpackHot = require('koa-webpack-hot-middleware')

    const middleware = await koaWebpack({
      compiler: getWebpackCompiler(),
      devMiddleware: {
        logLevel: 'warn',
        publicPath: require('./webpack.config.js').output.publicPath,
      },
      // webpack-hot-client is not compatible with react-hot-loader, so we turn it off and set up
      // our own webpack-hot-middleware instead
      hotClient: false,
    })

    app.use(middleware)
    app.use(koaConvert(koaWebpackHot(getWebpackCompiler())))
  }

  fileStoreMiddleware(app)

  createRoutes(app, nydus, userSockets)

  const needToBuild = !(isDev || process.env.SB_PREBUILT_ASSETS)
  const compilePromise = needToBuild ? thenify(getWebpackCompiler().run)() : Promise.resolve()
  if (needToBuild) {
    log.info('In production mode, building assets...')
  }

  try {
    const servers = await resolvedRallyPointServers
    pingRegistry.setServers(servers)
    await initRouteCreatorPromise

    const stats = await compilePromise

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
})()
