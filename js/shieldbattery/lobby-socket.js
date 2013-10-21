var log = require('./logger')
  , sub = require('./sub')

function LobbySocket(socket) {
  this.socket = socket
  this.started = false
  this.curLobby = null
  this.subs = []

  socket.on('setRace', this.onSetRace.bind(this))
}

LobbySocket.prototype.installLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.push(sub(this.curLobby, 'downloadStatus', this.onDownloadStatus.bind(this)))
}

LobbySocket.prototype.clearLobbyHandlers = function() {
  if (!this.curLobby) return
  this.subs.forEach(function(unsub) { unsub() })
  this.subs.length = 0
}

LobbySocket.prototype.onSetRace = function(race, cb) {
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

LobbySocket.prototype.onDownloadStatus = function(slot, percent) {
  // TODO(tec27): we also need to be able to know when players leave/disconnect
  if (percent == 100) {
    this.socket.emit('playerJoined', { slot: slot, player: this.curLobby.slots[slot].name })
  }
}

LobbySocket.prototype.onGameFinished = function(err) {
  this.clearLobbyHandlers()
  this.started = false
  this.curLobby = null
  if (err) {
    log.error(err)
    this.socket.emit('gameFinished', err)
  } else {
    log.verbose('game finished')
    this.socket.emit('gameFinished')
  }
}

module.exports = LobbySocket
