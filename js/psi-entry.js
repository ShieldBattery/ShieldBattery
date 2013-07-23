var psi = require('psi')
  , path = require('path')
  , httpServer = require('http').createServer(onHttpRequest)
  , io = require('socket.io').listen(httpServer)

httpServer.listen(33198, '127.0.0.1')

io.configure(function() {
  io.set('transports', ['websocket'])
})

var siteSockets = io.of('/site')
  , gameSocket

siteSockets.on('connection', function(socket) {
  console.log('site client connected.')
  socket.on('launch', function(cb) {
    doLaunch(cb)
  }).on('disconnect', function() {
    console.log('site client disconnected.')
  }).on('game:load', function(plugins, cb) {
    if (gameSocket) {
      gameSocket.emit('load', plugins, function(errors) { cb(errors) })
    }
  }).on('game:start', function(params) {
    if (gameSocket) {
      gameSocket.emit('start', params)
    }
  }).on('game:join', function(params) {
    if (gameSocket) {
      gameSocket.emit('join', params)
    }
  })
})

io.of('/game').on('connection', function(socket) {
  console.log('game client connected.')
  siteSockets.emit('game:connected')
  gameSocket = socket
  socket.on('disconnect', function() {
    console.log('game client disconnected.')
    siteSockets.emit('game:disconnected')
    gameSocket = null
  }).on('error', function(err) {
    console.log('game client error: ' + err)
  }).on('status', function(status) {
    siteSockets.emit('game:status', status)
  })
})

function doLaunch(plugins, cb) {
  // TODO(tec27): we should also try to guess the install path as %ProgramFiles(x86%/Starcraft and
  // %ProgramFiles%/Starcraft, and allow this to be set through the web interface as well
  var installPath = psi.getInstallPathFromRegistry()
  installPath = installPath || 'C:\\Program Files (x86)\\Starcraft'
  var appPath = installPath +
      (installPath.charAt(installPath.length - 1) == '\\' ? '' : '\\') +
      'Starcraft.exe'

  psi.launchProcess(
      { appPath: appPath
      , launchSuspended: true
      , currentDir: installPath
      }, function(err, proc) {
        if (err) return cb({ when: 'launching process', msg: err.message })

        console.log('Process launched!')
        var shieldbatteryRoot = path.dirname(process.execPath)
          , shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')

        proc.injectDll(shieldbatteryDll, 'OnInject', function(err) {
          if (err) return cb({ when: 'injecting dll', msg: err.message })

          console.log('Dll injected! Attempting to resume process...')

          var resumeErr = proc.resume()
          console.log('Process resumed!')
          if (resumeErr) cb({ when: 'resuming process', msg: resumeErr.message })
        })
      })
}

function onHttpRequest(req, res) {
  res.writeHead(404)
  res.end()
}

process.on('uncaughtException', function(err) {
  console.log(err.message)
  console.log(err.stack)
  setTimeout(function() { process.exit() }, 15000)
})
