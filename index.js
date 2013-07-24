var canonicalHost = require('canonical-host')
  , express = require('express')
  , fs = require('fs')
  , http = require('http')
  , https = require('https')
  , path = require('path')
  , socketio = require('socket.io')
  , stylus = require('stylus')

var app = express()
app.set('port', 443)
  .set('views', path.join(__dirname, 'views'))
  .set('view engine', 'jade')
  .use(express.logger('dev'))
  .use(express.bodyParser())
  .use(express.methodOverride())
  .use(stylus.middleware({ src: path.join(__dirname, 'styles') }))
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
})

app.get('/', function(req, res) {
  res.send('Warp field stabilized.')
})

httpsServer.listen(app.get('port'), function() {
  console.log('Server listening on port ' + app.get('port'))
})

// create a server that simply forwards requests to https
var canon = canonicalHost('https://localhost', 301)
http.createServer(function(req, res) {
  if (canon(req, res)) return
  // shouldn't ever get here, but if we do, just kill the connection
  res.statusCode = 400
  res.end('Bad request\n')
}).listen(80)
