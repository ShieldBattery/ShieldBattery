var psi = require('psi')
  , path = require('path')
  , httpServer = require('http').createServer(onHttpRequest)
  , io = require('socket.io').listen(httpServer)

httpServer.listen(33198, '127.0.0.1')

console.log('Psi entry-point running!')

io.configure(function() {
  io.set('transports', ['websocket'])
})

io.sockets.on('connection', function(socket) {
  console.log('client connected!')
  socket.on('launch', function(cb) {
    doLaunch(cb)
  })
})

function doLaunch(cb) {
  console.log('All systems gone! Prepare for downcount!')
  psi.launchProcess(
      { appPath: 'C:\\Program Files (x86)\\Starcraft\\Starcraft.exe'
      , launchSuspended: true
      , currentDir: 'C:\\Program Files (x86)\\Starcraft'
      }, function(err, proc) {
        if (err) return cb({ when: 'launching process', msg: err.message })

        console.log('Process launched!')
        var shieldbatteryRoot = path.dirname(process.execPath)
          , shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')

        proc.injectDll(shieldbatteryDll, 'scout_onInject', function(err) {
          if (err) return cb({ when: 'injecting dll', msg: err.message })

          console.log('Dll injected! Attempting to resume process...')
          var resumeErr = this.resume()
          console.log('Process resumed!')
          if (resumeErr) cb({ when: 'resuming process', msg: resumeErr.message })
        })
      })
}

function onHttpRequest(req, res) {
  res.writeHead(404)
  res.end()
}
