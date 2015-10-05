import config from './config'
import webpack from 'webpack'
import webpackConfig from './webpack.config.js'

import http from 'http'
import https from 'https'

import canonicalHost from 'canonical-host'
import isDev from './server/env/is-dev'
import koa from 'koa'
import log from './server/logging/logger'
import path from 'path'
import thenify from 'thenify'

import csrf from 'koa-csrf'
import csrfCookie from './server/security/csrf-cookie'
import koaBody from 'koa-body'
import koaCompress from 'koa-compress'
import koaError from 'koa-error'
import logMiddleware from './server/logging/log-middleware'
import secureHeaders from './server/security/headers'
import secureJson from './server/security/json'
import sessionMiddleware from './server/session/middleware'
import views from 'koa-views'

const app = koa()
const port = config.https ? config.httpsPort : config.httpPort

app.keys = [ config.sessionSecret ]

app.on('error', err => {
  if (err.status && err.status < 500) return // likely an HTTP error (expected and fine)

  log.error({ err }, 'server error')
})

app
  .use(logMiddleware())
  .use(koaError()) // TODO(tec27): Customize error view
  .use(koaCompress())
  .use(views(path.join(__dirname, 'views'), { default: 'jade' }))
  .use(koaBody())
  .use(sessionMiddleware)
  .use(csrfCookie())
  .use(csrf())
  .use(secureHeaders())
  .use(secureJson())

import createRoutes from './routes'
createRoutes(app)

let mainServer
if (config.https) {
  mainServer = https.createServer(config.https, app.callback())
  // create a server that simply forwards requests to https
  const canon = canonicalHost(config.canonicalHost, 301)
  http.createServer(function(req, res) {
    if (canon(req, res)) return
    // shouldn't ever get here, but if we do, just kill the connection
    res.statusCode = 400
    res.end('Bad request\n')
  }).listen(config.httpPort)
} else {
  mainServer = http.createServer(app.callback())
}

import setupWebsockets from './websockets'
setupWebsockets(mainServer, app, sessionMiddleware)

const compiler = webpack(webpackConfig)
compiler.run = thenify(compiler.run)
const compilePromise = isDev ? Promise.resolve() : compiler.run()
if (!isDev) {
  log.info('In production mode, building assets...')
}

compilePromise.then(stats => {
  if (stats) {
    if ((stats.errors && stats.errors.length) || (stats.warnings && stats.warnings.length)) {
      throw new Error(stats.toString())
    }

    const statStr = stats.toString({ colors: true })
    log.info(`Webpack stats:\n${statStr}`)
  }

  mainServer.listen(port, function() {
    log.info('Server listening on port ' + port)
  })
}).catch(err => {
  log.error({ err }, 'Error building assets')
  process.exit(1)
})
