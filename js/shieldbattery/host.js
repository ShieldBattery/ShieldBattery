var bw = require('bw')
  , log = require('./logger')
  , sub = require('./sub')

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
  this.socket = socket
  this.started = false
  this.curLobby = null
  this.subs = []

  socket.on('createLobby', this.onCreateLobby.bind(this, socket))
  socket.on('setRace', this.onSetRace.bind(this, socket))
  socket.on('startGame', this.onStartGame.bind(this, socket))
}

HostHandler.prototype.installLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.push(sub(this.curLobby, 'downloadStatus', this.onDownloadStatus.bind(this)))
}

HostHandler.prototype.clearLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.forEach(function(unsub) { unsub() })
  this.subs.length = 0
}

HostHandler.prototype.onCreateLobby = function(socket, params, cb) {
  var self = this
  if (this.started) {
    return cb({ msg: 'A game has already been started' })
  }

  this.started = true
  bw.initProcess(function afterInit() {
    log.verbose('Process initialized.')

    var gameSettings =  { mapPath: params.map
                        , gameType: 0x00010002 // melee (see TODO above)
                        }
    bw.createLobby(params.username, gameSettings, onCreated)
  })

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

HostHandler.prototype.onSetRace = function(socket, race, cb) {
  if (!this.started || !this.curLobby) {
    log.error('setRace called without being in a lobby')
    return cb({ msg: 'You are not in a lobby' })
  }

  this.curLobby.setRace(race, function(err) {
    if (err) {
      log.error(err)
      return cb({ msg: err.message })
    }

    cb()
  })
}

HostHandler.prototype.onDownloadStatus = function(slot, percent) {
  // TODO(tec27): we also need to be able to know when players leave/disconnect
  if (percent == 100) {
    this.socket.emit('playerJoined', { slot: slot, player: this.curLobby.slots[slot].name })
  }
}

HostHandler.prototype.onStartGame = function(socket, cb) {
  if (!this.started || !this.curLobby) {
    log.error('startGame called without being in a lobby')
    return cb({ msg: 'You are not in a lobby' })
  }

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
      self.curLobby.runGameLoop(self.onGameFinished.bind(self, socket))
      self.socket.emit('gameStarted')
      log.verbose('game started')
      cb()
    }
  })
}

HostHandler.prototype.onGameFinished = function(socket, err) {
  this.clearLobbyHandlers()
  this.started = false
  this.curLobby = null
  if (err) {
    log.error(err)
    socket.emit('gameFinished', err)
  } else {
    log.verbose('game finished')
    socket.emit('gameFinished')
  }
}
