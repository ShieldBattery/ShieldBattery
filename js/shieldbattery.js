// Put log and bw first to ensure we can log as much as possible in the event of a crash
import log from './shieldbattery/logger'
process.on('uncaughtException', function(err) {
  console.error(err.stack)
  log.error(err.stack)
  // give the log time to write out
  setTimeout(function() {
    process.exit(0x27272727)
  }, 100)
}).on('unhandledRejection', function(err) {
  log.error('Unhandled rejection:\n' + err.stack)
  if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
    // These types are very unlikely to be handle-able properly, exit
    setTimeout(function() {
      process.exit(0x27272727)
    }, 100)
  }
  // Other promise rejections are likely less severe, leave the process up but log it
})

import bw from './shieldbattery/natives/bw'
bw.on('log', function(level, msg) {
  log.log(level, msg)
})

import repl from 'repl'
import nydusClient from 'nydus-client'
import forge from './shieldbattery/natives/forge'
import initGame from './shieldbattery/init-game'

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
  extraHeaders: {
    origin: 'BROODWARS',
    'x-game-id': process.argv[process.argv.length - 1]
  }
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

let gameInitializer
socket.registerRoute('/game/:id', (route, event) => {
  if (event.command === 'quit') {
    log.verbose('Received quit command')
    forge.endWndProc() // ensure that we aren't blocking the UI thread with forge's wndproc
    bw.cleanUpForExit(() => setTimeout(() => process.exit(), 100))
  } else if (event.command === 'setConfig') {
    gameInitializer = initGame(socket, event.payload)
  } else if (event.command === 'setRoutes') {
    gameInitializer.setRoutes(event.payload)
  } else {
    log.verbose(`TODO: ${JSON.stringify(event)}`)
  }
})

socket.connect()
