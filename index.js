var config = require('./config')

var canonicalHost = require('canonical-host')
  , express = require('express')
  , fs = require('fs')
  , http = require('http')
  , https = require('https')
  , path = require('path')
  , redis = require('./redis')
  , RedisStore = require('connect-redis')(express)
  , socketio = require('socket.io')
  , stylus = require('stylus')

var sessionStore = new RedisStore({ client: redis
                                  , ttl: config.sessionTtl
                                  })

function getCsrfToken(req) {
  return (
      (req.headers['x-xsrf-token']) ||
      (req.body && req.body._csrf) ||
      (req.query && req.query._csrf)
  )
}

function setCsrfToken(req, res, next) {
  res.cookie('XSRF-TOKEN', req.session._csrf)
  next()
}

var app = express()
app.set('port', config.httpsPort)
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'jade')
  .use(express.bodyParser())
  .use(express.methodOverride())
  .use(express.cookieParser())
  .use(express.session( { store: sessionStore
                        , secret: config.sessionSecret
                        , cookie: { secure: true, maxAge: config.sessionTtl }
                        }))
  .use(express.csrf({ value: getCsrfToken }))
  .use(setCsrfToken)
  .use(require('./secureHeaders'))
  .use(express.favicon())
  .use(stylus.middleware( { src: path.join(__dirname)
                          , dest: path.join(__dirname, 'public')
                          }))
  .use(express.static(path.join(__dirname, 'public')))
  .use(app.router)

if (app.get('env') == 'development') {
  app.use(express.errorHandler())
    .use(express.logger('dev'))
}

var httpsOptions =  { ca: []
                    , key: fs.readFileSync(require.resolve('./certs/server.key'), 'utf8')
                    , cert: fs.readFileSync(require.resolve('./certs/server.crt'), 'utf8')
                    }
  , httpsServer = https.createServer(httpsOptions, app)
  , io = socketio.listen(httpsServer, { secure: true })

io.configure(function() {
  io.set('transports', ['websocket'])
    .enable('browser client minification')
    .enable('browser client etag')
})

require('./routes')(app)

httpsServer.listen(app.get('port'), function() {
  console.log('Server listening on port ' + app.get('port'))
})

// create a server that simply forwards requests to https
var canon = canonicalHost(config.canonicalHost, 301)
http.createServer(function(req, res) {
  if (canon(req, res)) return
  // shouldn't ever get here, but if we do, just kill the connection
  res.statusCode = 400
  res.end('Bad request\n')
}).listen(config.httpPort)
