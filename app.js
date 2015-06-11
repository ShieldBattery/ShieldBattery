var config = require('./config')

var http = require('http')
  , https = require('https')

var canonicalHost = require('canonical-host')
  , cuid = require('cuid')
  , koa = require('koa')
  , log = require('./server/logging/logger')
  , path = require('path')

var csrf = require('koa-csrf')
  , csrfCookie = require('./server/security/csrf-cookie')
  , koaBody = require('koa-body')
  , koaCompress = require('koa-compress')
  , koaError = require('koa-error')
  , logMiddleware = require('./server/logging/log-middleware')
  , secureHeaders = require('./server/security/headers')
  , secureJson = require('./server/security/json')
  , sessionMiddleware = require('./server/session/middleware')
  , views = require('koa-views')

var app = koa()
  , port = config.https ? config.httpsPort : config.httpPort

app.keys = [ config.sessionSecret ]

app.on('error', err => {
  if (err.status && err.status < 500) return // likely an HTTP error (expected and fine)

  log.error({ err: err }, 'server error')
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

require('./routes')(app)

var mainServer
if (config.https) {
  mainServer = https.createServer(config.https, app.callback())
  // create a server that simply forwards requests to https
  var canon = canonicalHost(config.canonicalHost, 301)
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
