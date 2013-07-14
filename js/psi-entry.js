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
  psi.launchProcess(
      { appPath: 'C:\\Program Files (x86)\\Starcraft\\Starcraft.exe'
      , launchSuspended: true
      , currentDir: 'C:\\Program Files (x86)\\Starcraft'
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
