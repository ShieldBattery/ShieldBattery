// Put log and bw first to ensure we can log as much as possible in the event of a crash
import log from './js/logger'
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

import bw from './js/natives/bw'
bw.on('log', function(level, msg) {
  log.log(level, msg)
})

import nydusClient from 'nydus-client'
import forge from './js/natives/forge'
import initGame from './js/init-game'

const port = process.argv[process.argv.length - 1]
const gameId = process.argv[process.argv.length - 2]
log.verbose(`Connecting to game server on port ${port} with game ID ${gameId}`)
const socket = nydusClient(`ws://localhost:${port}`, {
  extraHeaders: {
    origin: 'BROODWARS',
    'x-game-id': gameId
  }
})

const timeoutId = setTimeout(() => {
  log.error('Never received a command, ending process')
  setTimeout(function() {
    process.exit(0x27272728)
  }, 100)
}, 2 * 60 * 1000)

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

bw.on('replaySave', replayPath => {
  log.verbose(`Replay saved to ${replayPath}`)
  socket.invoke('/game/replaySave', { path: replayPath })
})

let gameInitializer
socket.registerRoute('/game/:id', (route, event) => {
  clearTimeout(timeoutId)
  if (event.command === 'quit') {
    log.verbose('Received quit command')
    forge.endWndProc() // ensure that we aren't blocking the UI thread with forge's wndproc
    bw.cleanUpForExit(() => setTimeout(() => process.exit(), 100))
  } else if (event.command === 'setConfig') {
    clearTimeout(timeoutId)
    gameInitializer = initGame(socket, event.payload)
  } else if (event.command === 'setRoutes') {
    gameInitializer.setRoutes(event.payload)
  } else {
    log.verbose(`TODO: ${JSON.stringify(event)}`)
  }
})

socket.connect()
