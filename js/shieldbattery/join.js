var bw = require('shieldbattery-bw')
  , LobbySocket = require('./lobby-socket')
  , log = require('./logger')
  , util = require('util')
  , forge = require('forge-shieldbattery')

module.exports = function(socket) {
  return new JoinHandler(socket)
}

function JoinHandler(socket) {
  LobbySocket.call(this, socket)
  socket.on('joinLobby', this.onJoinLobby.bind(this))
}
util.inherits(JoinHandler, LobbySocket)

JoinHandler.prototype.onJoinLobby = function(params, cb) {
  var self = this
  if (this.started) {
    return cb({ msg: 'A game has already been started' })
  }

  this.started = true
  log.verbose('joinLobby called')
  bw.joinLobby(params.username, params.host, params.port, onJoined)

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

    self.curLobby.once('gameInit', function() {
      forge.endWndProc()
      self.curLobby.runGameLoop(self.onGameFinished.bind(self))
      self.socket.emit('gameStarted')
      log.verbose('game started')
    })
  }
}

