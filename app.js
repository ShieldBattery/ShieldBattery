var config = require('./config')

var http = require('http')
  , https = require('https')

var canonicalHost = require('canonical-host')
  , cuid = require('cuid')
  , koa = require('koa')
  , log = require('./server/logging/logger')
  , path = require('path')
  , redis = require('./redis')

var csrf = require('koa-csrf')
  , csrfCookie = require('./server/security/csrf-cookie')
  , koaBody = require('koa-body')
  , koaCompress = require('koa-compress')
  , koaError = require('koa-error')
  , koaStatic = require('koa-static')
  , logMiddleware = require('./server/logging/log-middleware')
  , redisStore = require('koa-redis')
  , secureHeaders = require('./server/security/headers')
  , secureJson = require('./server/security/json')
  , session = require('koa-generic-session')
  , stylus = require('koa-stylus')
  , views = require('koa-views')

var app = koa()
  , port = config.https ? config.httpsPort : config.httpPort

app.keys = [ config.sessionSecret ]

app.on('error', err => log.error({ err: err }, 'server error'))

var sessionMiddleware = session({
  key: 's',
  store: redisStore({ client: redis }),
  cookie: {
    secure: !!config.https,
    maxAge: config.sessionTtl * 1000,
  },
  rolling: true,
  genSid: () => cuid()
})

app
  .use(logMiddleware())
  .use(koaError()) // TODO(tec27): Customize error view
  .use(koaCompress())
  .use(views(path.join(__dirname, 'views'), { default: 'jade' }))
  .use(koaBody())
  .use(stylus({
    src: __dirname,
    dest: path.join(__dirname, 'public'),
  }))
  .use(koaStatic(path.join(__dirname, 'public')))
  .use(sessionMiddleware)
  .use(csrfCookie())
  .use(csrf())
  .use(secureHeaders())
  .use(secureJson())

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
require('./routes')(app)

mainServer.listen(port, function() {
  log.info('Server listening on port ' + port)
})
