// Put log and bw first to ensure we can log as much as possible in the event of a crash
import log from './shieldbattery/logger'
process.on('uncaughtException', function(err) {
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit()
  }, 100)
})

import bw from './shieldbattery/natives/bw'
bw.on('log', function(level, msg) {
  log.log(level, msg)
})

import repl from 'repl'
import setupRoutes from './shieldbattery/routes'
import nydusClient from 'nydus-client'
import forge from './shieldbattery/natives/forge'
import './shieldbattery/natives/snp'

bw.chatHandler.on('thisisnotwarcraftinspace', function() {
  log.debug('got repl command')
  bw.sendChatMessage.apply(bw, arguments)
  bw.displayIngameMessage('it\'s much more sophisticated!', 60000)
  const chatStream = bw.chatHandler.grabExclusiveStream()
  const remote = repl.start({ input: chatStream, output: chatStream, terminal: false })

  chatStream.setMessageTimeout(60000)

  remote.context.bw = bw
  remote.on('exit', function() {
    log.debug('repl exited')
    chatStream.close()
  })
})

const socket = nydusClient('wss://lifeoflively.net:33198', {
  websocketOptions: { origin: 'BROODWARS' }
})

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
  bw.cleanUpForExit(onCleanedUpForExit)
})

setupRoutes(socket)

function initialize(settings, cb) {
  bw.setSettings(settings)

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

function onCleanedUpForExit() {
  setTimeout(function() {
    process.exit()
  }, 100)
}
