var bw = require('bw')
  , log = require('./logger')
  , sub = require('./sub')

module.exports = function(socket) {
  return new JoinHandler(socket)
}

// TODO(tec27): Figure out how to extract out the common code between this and HostHandler
function JoinHandler(socket) {
  this.socket = socket
  this.started = false
  this.curLobby = null
  this.subs = []

  socket.on('joinLobby', this.onJoinLobby.bind(this))
  socket.on('setRace', this.onSetRace.bind(this))
}

JoinHandler.prototype.installLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.push(sub(this.curLobby, 'downloadStatus', this.onDownloadStatus.bind(this)))
}

JoinHandler.prototype.clearLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.forEach(function(unsub) { unsub() })
  this.subs.length = 0
}

JoinHandler.prototype.onJoinLobby = function(params, cb) {
  var self = this
  if (this.started) {
    return cb({ msg: 'A game has already been started' })
  }

  this.started = true
  bw.initProcess(function afterInit() {
    log.verbose('Process initialized.')

    bw.joinLobby(params.username, params.host, params.port, onJoined)
  })

  function onJoined(err, newLobby) {
    if (err) {
      self.started = false
      log.error(err)
      cb({ msg: err.message })
      return
    }

    self.curLobby = newLobby
    self.installLobbyHandlers()
    cb()

    self.curLobby.once('gameInit') {
      self.curLobby.runGameLoop(self.onGameFinished.bind(self))
      self.socket.emit('gameStarted')
      log.verbose('game started')
    }
  }
}

JoinHandler.prototype.onSetRace = function(race, cb) {
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

JoinHandler.prototype.onDownloadStatus = function(slot, percent) {
  // TODO(tec27): we also need to be able to know when players leave/disconnect
  if (percent == 100) {
    this.socket.emit('playerJoined', { slot: slot, player: this.curLobby.slots[slot].name })
  }
}

JoinHandler.prototype.onGameFinished = function(err) {
  this.clearLobbyHandlers()
  this.started = false
  this.curLobby = null
  if (err) {
    log.error(err)
    this.socket.emit('gameFinished', err)
  } else {
    log.verbose('game finished')
    this.socket.emit('gameFinished')
  }}
