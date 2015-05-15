var bw = require('shieldbattery-bw')
  , log = require('./logger')
  , forge = require('forge-shieldbattery')
  , lobbyStore = require('./lobby-store')
  , sub = require('./sub')

var socket
  , lobbySubs = []

module.exports = function(socket_) {
  socket = socket_
  // host only
  socket.router.call('/createLobby', onCreateLobby)
    .call('/addComputer', onAddComputer)
    .call('/startGame', onStartGame)
  // joiner only
  socket.router.call('/joinLobby', onJoinLobby)
  // common
  socket.router.call('/setRace', onSetRace)
}

// TODO(tec27): make a constants file, but: Possible values for Game Type (Sub Game Type):
// 0x02: Melee 0x03: Free for All 0x04: 1 vs 1 0x05: Capture The Flag
// 0x06: Greed (Resources, 0x01: 2500, 0x02: 500, 0x03: 7500, 0x04: 10000)
// 0x07: Slaughter (Minutes, 0x01: 15, 0x02: 30, 0x03: 45, 0x04: 60) 0x08: Sudden Death
// 0x09: Ladder (Disconnects, 0x00: Not a loss, 0x01: Counts as a loss) 0x0A: Use Map Settings
// 0x0B: Team Melee (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0C: Team Free For All (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0D: Team Capture The Flag (Number Of Teams, 0x01: 2 Teams, 0x02: 3 Teams, etc.)
// 0x0F: Top vs. Bottom (Number Of Teams, 1-7 specifies the ratio of players belonging to both teams
// 0x20: PGL
// any mode without a sub game type is just always 0x01 for that

function onCreateLobby(req, res, params) {
  if (lobbyStore.starting || lobbyStore.lobby) {
    return res.fail(409, 'conflict', { msg: 'A game has already been started' })
  }

  log.verbose('createLobby called')
  lobbyStore.starting = true
  var gameSettings =  { mapPath: params.map
                      , gameType: 0x00010002 // melee (see TODO above)
                      }
  bw.createLobby(params.username, gameSettings, onCreated)

  function onError(err) {
    lobbyStore.starting = false
    log.error(err)
    res.fail(500, 'internal server error', { msg: err.message })
  }

  function onCreated(err, newLobby) {
    if (err) return onError(err)

    lobbyStore.lobby = newLobby
    lobbyStore.starting = false
    handleLobbyCreated()
    res.complete()
  }
}

function onJoinLobby(req, res, params) {
  if (lobbyStore.starting || lobbyStore.lobby) {
    return res.fail(409, 'conflict', { msg: 'A game has already been started' })
  }

  lobbyStore.starting = true
  log.verbose('joinLobby called')
  if (params.host.indexOf('::ffff:') === 0) {
    log.warning('converting ipv6 wrapped ipv4 address')
    params.host = params.host.replace('::ffff:', '')
  } else if (params.host.indexOf(':') != -1) {
    log.error(new Error('SNP doesn\'t support ipv6 yet!'))
    return res.fail(500, 'internal server error', { msg: 'SNP doesn\'t support ipv6 yet!' })
  }
  bw.joinLobby(params.username, params.host, params.port, onJoined)

  function onJoined(err, newLobby) {
    lobbyStore.starting = false
    if (err) {
      log.error(err)
      return res.fail(500, 'internal server error', { msg: err.message })
    }

    lobbyStore.lobby = newLobby
    handleLobbyCreated()
    res.complete()

    newLobby.once('gameInit', function() {
      forge.endWndProc()
      newLobby.runGameLoop(onGameFinished)
      socket.publish('/gameStarted', null)
      log.verbose('game started')
    })
  }
}

function onAddComputer(req, res, race) {
  if (!lobbyStore.starting && !lobbyStore.lobby) {
    log.error('addComputer called without being in a lobby')
    return res.fail(409, 'conflict', { msg: 'You are not in a lobby' })
  }

  log.verbose('addComputer(' + race + ') called')
  log.verbose(JSON.stringify(lobbyStore.lobby.slots, null, 2))
  // find the first empty slot to add a computer to. Kind of hacky, ideally this would be based off
  // of the slot order in the website lobby, but currently we have no guarantee that ordering will
  // be maintained
  var targetSlot = -1
  for (var i = 0; i < lobbyStore.lobby.slots.length; i++) {
    var slotType = lobbyStore.lobby.slots[i].type
    if (slotType == 'open') {
      targetSlot = i
      break
    }
  }

  if (targetSlot == -1) {
    log.error('Could not find an empty slot for computer')
    return res.fail(409, 'conflict', { msg: 'No empty slot could be found' })
  }

  lobbyStore.lobby.addComputer(targetSlot, function(err) {
    if (err) {
      log.error(err)
      return res.fail(500, 'internal server error', { msg: err.message })
    }

    log.verbose('Computer added, setting race for it')
    lobbyStore.lobby.setRace(targetSlot, race, function(err) {
      if (err) {
        log.error(err)
        return res.fail(500, 'internal server error', { msg: err.message })
      }

      res.complete()
    })
  })
}

function onStartGame(req, res) {
  if (!lobbyStore.starting && !lobbyStore.lobby) {
    log.error('startGame called without being in a lobby')
    return res.fail(409, 'conflict', { msg: 'You are not in a lobby' })
  }

  log.verbose('startGame called')

  lobbyStore.lobby.startCountdown(function(err) {
    if (err) {
      log.error(err)
      return res.fail(500, 'internal server error', { msg: err.message })
    }

    var timeout = setTimeout(function() {
      log.error('Starting game timed out')
      res.fail(504, 'gateway timeout', { msg: 'Starting game timed out' })
      lobbyStore.lobby.removeListener('gameInit', onGameInit)
    }, 5000)

    lobbyStore.lobby.once('gameInit', onGameInit)

    function onGameInit() {
      clearTimeout(timeout)
      forge.endWndProc()
      lobbyStore.lobby.runGameLoop(onGameFinished)
      res.complete()
      socket.publish('/gameStarted', null)
      log.verbose('game started')
    }
  })
}

function onSetRace(req, res, race) {
  if (!lobbyStore.starting && !lobbyStore.lobby) {
    log.error('setRace called without being in a lobby')
    return res.fail(409, 'conflict', { msg: 'You are not in a lobby' })
  }

  log.verbose('setRace(' + race + ') called')
  lobbyStore.lobby.setRace(race, function(err) {
    if (err) {
      log.error(err)
      return res.fail(500, 'internal server error', { msg: err.message })
    }

    res.complete()
  })
}

function onGameFinished(err, gameResults, gameTime) {
  log.verbose('gameResults: ' + require('util').inspect(gameResults))
  log.verbose('gameTime: ' + gameTime)
  handleLobbyDestroyed()
  lobbyStore.lobby = null
  if (err) {
    log.error(err)
    socket.publish('/gameFinished', err)
  } else {
    log.verbose('game finished')
    socket.publish('/gameFinished', null)
  }
}

function onDownloadStatus(slot, percent) {
  // TODO(tec27): we also need to be able to know when players leave/disconnect
  if (percent == 100) {
    socket.publish('/playerJoined', { slot: slot, player: lobbyStore.lobby.slots[slot].name })
  }
}

function handleLobbyCreated() {
  lobbySubs.push(sub(lobbyStore.lobby, 'downloadStatus', onDownloadStatus))
}

function handleLobbyDestroyed() {
  lobbySubs.forEach(function(unsub) { unsub() } )
  lobbySubs.length = 0
}
