var config = require('./config')

var canonicalHost = require('canonical-host')
  , express = require('express')
  , fs = require('fs')
  , http = require('http')
  , https = require('https')
  , log = require('./logger')
  , path = require('path')
  , redis = require('./redis')
  , RedisStore = require('connect-redis')(express)
  , stylus = require('stylus')

var sessionStore = new RedisStore({ client: redis
                                  , ttl: config.sessionTtl
                                  })
  , sessionWare = express.session({ store: sessionStore
                                  , secret: config.sessionSecret
                                  , cookie: { secure: true, maxAge: config.sessionTtl * 1000 }
                                  })
  , cookieParser = express.cookieParser()

var app = express()
app.set('port', config.httpsPort)
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'jade')
  .disable('x-powered-by')
  .use(require('./util/log-middleware')())
  .use(express.urlencoded())
  .use(express.json())
  .use(express.methodOverride())
  .use(cookieParser)
  // all static things should be above csrf/session checks since they don't depend on them and we
  // don't want to be making a ton of unnecessary requests to redis, etc.
  .use(express.favicon())
  .use(stylus.middleware( { src: path.join(__dirname)
                          , dest: path.join(__dirname, 'public')
                          }))
  .use(express.static(path.join(__dirname, 'public')))
  .use(sessionWare)
  .use(require('./util/csrf')())
  .use(require('./util/secureHeaders'))
  .use(require('./util/secureJson'))
  .use(app.router)

if (app.get('env') == 'development') {
  // TODO(tec27): replace this with a handler that can be used in production and dev, but displays
  // more detail in dev.
  app.use(express.errorHandler())
}

var httpsServer = https.createServer(config.https, app)

require('./websockets')(httpsServer, cookieParser, sessionWare)
require('./routes')(app)

httpsServer.listen(app.get('port'), function() {
  log.info('Server listening on port ' + app.get('port'))
})

// create a server that simply forwards requests to https
var canon = canonicalHost(config.canonicalHost, 301)
http.createServer(function(req, res) {
  if (canon(req, res)) return
  // shouldn't ever get here, but if we do, just kill the connection
  res.statusCode = 400
  res.end('Bad request\n')
}).listen(config.httpPort)
