import config from './config'

import http from 'http'
import https from 'https'

import canonicalHost from 'canonical-host'
import koa from 'koa'
import log from './server/logging/logger'
import path from 'path'

import csrf from 'koa-csrf'
import csrfCookie from './server/security/csrf-cookie'
import koaBody from 'koa-body'
import koaCompress from 'koa-compress'
import koaError from 'koa-error'
import logMiddleware from './server/logging/log-middleware'
import secureHeaders from './server/security/headers'
import secureJson from './server/security/json'
import sessionMiddleware from './server/session/middleware'
import stylish from './server/styles/stylish'
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
  .use(stylish())
  .use(views(path.join(__dirname, 'views'), { default: 'jade' }))
  .use(koaBody())
  .use(sessionMiddleware)
  .use(csrfCookie())
  .use(csrf())
  .use(secureHeaders())
  .use(secureJson())

require('./routes')(app)

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

require('./websockets')(mainServer, app, sessionMiddleware)

mainServer.listen(port, function() {
  log.info('Server listening on port ' + port)
})
