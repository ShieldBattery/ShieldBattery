var config = require('./config')

var canonicalHost = require('canonical-host')
  , express = require('express')
  , http = require('http')
  , https = require('https')
  , log = require('./logger')
  , path = require('path')
  , redis = require('./redis')
  , expressSession = require('express-session')
  , RedisStore = require('connect-redis')(expressSession)
  , stylus = require('stylus')
  , bodyParser = require('body-parser')
  , cookieParser = require('cookie-parser')()
  , serveStatic = require('serve-static')
  , errorHandler = require('errorhandler')
  , csrfCookie = require('./util/csrf-cookie')

var sessionStore = new RedisStore({ client: redis
                                  , ttl: config.sessionTtl
                                  })
  , sessionWare = expressSession({ store: sessionStore
                                  , secret: config.sessionSecret
                                  , cookie: { secure: !!config.https
                                            , maxAge: config.sessionTtl * 1000
                                            }
                                  , saveUninitialized: true
                                  , resave: true
                                  })

var app = express()
app.set('port', config.https ? config.httpsPort : config.httpPort)
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'jade')
  .disable('x-powered-by')
  .use(require('./util/log-middleware')())
  .use(cookieParser)
  .use(bodyParser.json())
  .use(bodyParser.urlencoded({ extended: true }))
  // all static things should be above csrf/session checks since they don't depend on them and we
  // don't want to be making a ton of unnecessary requests to redis, etc.
  .use(stylus.middleware( { src: path.join(__dirname)
                          , dest: path.join(__dirname, 'public')
                          }))
  .use(serveStatic(path.join(__dirname, 'public')))
  .use(sessionWare)
  .use(require('./util/csrf')())
  .use(csrfCookie)
  .use(require('./util/secureHeaders'))
  .use(require('./util/secureJson'))

if (app.get('env') == 'development') {
  // TODO(tec27): replace this with a handler that can be used in production and dev, but displays
  // more detail in dev.
  app.use(errorHandler())
}

var mainServer

if (config.https) {
  mainServer = https.createServer(config.https, app)
  // create a server that simply forwards requests to https
  var canon = canonicalHost(config.canonicalHost, 301)
  http.createServer(function(req, res) {
    if (canon(req, res)) return
    // shouldn't ever get here, but if we do, just kill the connection
    res.statusCode = 400
    res.end('Bad request\n')
  }).listen(config.httpPort)
} else {
  mainServer = http.createServer(app)
}

require('./websockets')(mainServer, cookieParser, sessionWare)
require('./routes')(app)

mainServer.listen(app.get('port'), function() {
  log.info('Server listening on port ' + app.get('port'))
})


