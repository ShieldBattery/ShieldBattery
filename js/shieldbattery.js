// Put log and bw first to ensure we can log as much as possible in the event of a crash
var log = require('./shieldbattery/logger')
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

var bw = require('shieldbattery-bw')
bw.on('log', function(level, msg) {
  log.log(level, msg)
})

var repl = require('repl')
bw.chatHandler.on('thisisnotwarcraftinspace', function() {
  log.debug('got repl command')
  bw.sendChatMessage.apply(bw, arguments)
  bw.displayIngameMessage('it\'s much more sophisticated!', 60000)
  var chatStream = bw.chatHandler.grabExclusiveStream()
    , remote = repl.start({ input: chatStream, output: chatStream, terminal: false })

  chatStream.setMessageTimeout(60000)

  remote.context.bw = bw
  remote.on('exit', function() {
    log.debug('repl exited')
    chatStream.close()
  })
})

var setupRoutes = require('./shieldbattery/routes')
  , socket = require('nydus-client')('wss://lifeoflively.net:33198',
      { websocketOptions: { origin: 'BROODWARS' } })
  , initialized = false

socket.on('connect', function() {
  log.verbose('Connected to psi.')
}).on('disconnect', function() {
  log.verbose('Disconnected from psi...')
}).on('error', function(err) {
  log.error('Error connecting to psi, is it running? Error: ' + err)
  setTimeout(function() {
    process.exit()
  }, 100)
})

socket.router.call('/setSettings', function(req, res, settings) {
  log.verbose('received settings, initializing')
  log.verbose('settings: ' + JSON.stringify(settings, null, 2))
  initialize(settings, function(err) {
    if (err) {
      res.fail(500, 'internal server error', { msg: err.message })
    } else {
      res.complete()
    }
  })
}).call('/quit', function(req, res) {
  res.complete()
  setTimeout(function() {
    process.exit()
  }, 100)
})

setupRoutes(socket)

function initialize(settings, cb) {
  initialized = true
  bw.setSettings(settings)

  var forge = require('forge-shieldbattery')
  if (!forge.inject()) {
    cb(new Error('forge injection failed'))
  } else {
    log.verbose('forge injected')
  }

  forge.on('startWndProc', function() {
    log.verbose('forge\'s wndproc pump started')
  }).on('endWndProc', function() {
    log.verbose('forge\'s wndproc pump finished')
  })

  bw.initProcess(function afterInit(err) {
    if (err) {
      return cb(err)
    }

    log.verbose('process initialized')
    forge.runWndProc()

    cb()
  })
}

