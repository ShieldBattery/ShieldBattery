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

var app = express()
app.set('port', config.httpsPort)
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'jade')
  .disable('x-powered-by')
  .use(express.logger('dev'))
  .use(express.bodyParser())
  .use(express.methodOverride())
  .use(express.cookieParser())
  .use(express.session( { store: sessionStore
                        , secret: config.sessionSecret
                        , cookie: { secure: true, maxAge: config.sessionTtl * 1000 }
                        }))
  .use(require('./util/csrf')())
  .use(require('./util/secureHeaders'))
  .use(require('./util/secureJson'))
  .use(express.favicon())
  .use(stylus.middleware( { src: path.join(__dirname)
                          , dest: path.join(__dirname, 'public')
                          }))
  .use(express.static(path.join(__dirname, 'public')))
  .use(app.router)

if (app.get('env') == 'development') {
  app.use(express.errorHandler())
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
