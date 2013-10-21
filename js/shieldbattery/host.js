var bw = require('bw')
  , LobbySocket = require('./lobby-socket')
  , log = require('./logger')
  , util = require('util')
  , forge = require('forge')

module.exports = function(socket) {
  return new HostHandler(socket)
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


function HostHandler(socket) {
  LobbySocket.call(this, socket)
  socket.on('createLobby', this.onCreateLobby.bind(this))
  socket.on('addComputer', this.onAddComputer.bind(this))
  socket.on('startGame', this.onStartGame.bind(this))
}
util.inherits(HostHandler, LobbySocket)

HostHandler.prototype.onCreateLobby = function(params, cb) {
  var self = this
  if (this.started) {
    return cb({ msg: 'A game has already been started' })
  }

  this.started = true
  log.verbose('createLobby called')
  var gameSettings =  { mapPath: params.map
                      , gameType: 0x00010002 // melee (see TODO above)
                      }
  bw.createLobby(params.username, gameSettings, onCreated)

  function onError(err) {
    self.started = false
    log.error(err)
    cb({ msg: err.message })
  }

  function onCreated(err, newLobby) {
    if (err) return onError(err)

    self.curLobby = newLobby
    self.installLobbyHandlers()
    cb()
  }
}

HostHandler.prototype.onSetRace = function(race, cb) {
  if (!this.started || !this.curLobby) {
    log.error('setRace called without being in a lobby')
    return cb({ msg: 'You are not in a lobby' })
  }

  log.verbose('setRace(' + race + ') called')
  this.curLobby.setRace(race, function(err) {
    if (err) {
      log.error(err)
      return cb({ msg: err.message })
    }

    cb()
  })
}

HostHandler.prototype.onAddComputer = function(race, cb) {
  var self = this
  if (!this.started || !this.curLobby) {
    log.error('addComputer called without being in a lobby')
    return cb({ msg: 'You are not in a lobby' })
  }

  log.verbose('addComputer(' + race + ') called')
  log.verbose(JSON.stringify(this.curLobby.slots, null, 2))
  // find the first empty slot to add a computer to. Kind of hacky, ideally this would be based off
  // of the slot order in the website lobby, but currently we have no guarantee that ordering will
  // be maintained
  var targetSlot = -1
  for (var i = 0; i < this.curLobby.slots.length; i++) {
    var slotType = this.curLobby.slots[i].type
    if (slotType == 'open') {
      targetSlot = i
      break
    }
  }

  if (targetSlot == -1) {
    log.error('Could not find an empty slot for computer')
    return cb({ msg: 'No empty slot could be found' })
  }

  this.curLobby.addComputer(targetSlot, function(err) {
    if (err) {
      log.error(err)
      return cb({ msg: err.message })
    }

    log.verbose('Computer added, setting race for it')
    self.curLobby.setRace(targetSlot, race, function(err) {
      if (err) {
        log.error(err)
        return cb({ msg: err.message })
      }

      return cb(null)
    })
  })
}

HostHandler.prototype.onStartGame = function(cb) {
  if (!this.started || !this.curLobby) {
    log.error('startGame called without being in a lobby')
    return cb({ msg: 'You are not in a lobby' })
  }

  log.verbose('startGame called')

  var self = this
  this.curLobby.startCountdown(function(err) {
    if (err) {
      log.error(err)
      return cb({ msg: err.message })
    }

    var timeout = setTimeout(function() {
      log.error('Starting game timed out')
      cb({ msg: 'Starting game timed out' })
      self.curLobby.removeListener('gameInit', onGameInit)
    }, 5000)

    self.curLobby.once('gameInit', onGameInit)

    function onGameInit() {
      clearTimeout(timeout)
      forge.endWndProc()
      self.curLobby.runGameLoop(self.onGameFinished.bind(self))
      self.socket.emit('gameStarted')
      log.verbose('game started')
      cb()
    }
  })
}

