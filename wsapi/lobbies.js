var Emitter = require('events').EventEmitter
  , Endpoint = require('../util/websocket-endpoint')
  , SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')
  , util = require('util')

module.exports = function(io) {
  return new LobbyHandler(io)
}

function LobbyHandler(io) {
  Endpoint.call(this, io, 'lobbies')

  this.lobbyMap = new SimpleMap()
  this.lobbies = []
  // player -> their current lobby. Each player can be in at most one lobby at a time.
  this.playerLobbyMap = new SimpleMap()
}
util.inherits(LobbyHandler, Endpoint)

var LOBBY_LIST_CHANNEL = 'lobbies/list'
  , LOBBY_LIST_MESSAGE = 'lobbies/message'
LobbyHandler.prototype.subscribe = function(socket, cb) {
  socket.join(LOBBY_LIST_CHANNEL)
  cb(this.lobbies)
}

LobbyHandler.prototype.unsubscribe = function(socket) {
  socket.leave(LOBBY_LIST_CHANNEL)
}

LobbyHandler.prototype._doCreateLobby = function(host, name, map, size) {
  var lobby = new Lobby(name, map, size)
  this.lobbyMap.put(lobby.name, lobby)
  listUtils.sortedInsert(this.lobbies, lobby, Lobby.compare)

  var self = this
  lobby.emitter.on('addPlayer', function onAddPlayer(slot, player) {
    self._updateJoinedLobby(lobby, { action: 'join', slot: slot, player: player })
    self.playerLobbyMap.put(player.name, lobby)
    self.io.users.get(player.name)
        .join(lobby._socketChannel)
        .on('connection', onConnection)
        .on('disconnect', onDisconnect)
  }).on('removePlayer', function onRemovePlayer(slot, player) {
    self.playerLobbyMap.del(player.name)
    self.io.users.get(player.name)
        .leave(lobby._socketChannel)
        .removeListener('connection', onConnection)
        .removeListener('disconnect', onDisconnect)
    self._updateJoinedLobby(lobby, { action: 'part', slot: slot })
  }).on('newHost', function onNewHost(playerName) {
    self._updateJoinedLobby(lobby, { action: 'newHost', name: playerName })
    self.io.sockets.in(LOBBY_LIST_CHANNEL)
        .emit(LOBBY_LIST_MESSAGE, { action: 'update', lobby: lobby })
  }).on('closed', function onLobbyClosed() {
    self.lobbyMap.del(lobby.name)
    var index = self.lobbies.indexOf(lobby)
    if (index != -1) {
      self.lobbies.splice(index, 1)
    }
    self.io.sockets.in(LOBBY_LIST_CHANNEL)
        .emit(LOBBY_LIST_MESSAGE, { action: 'remove', lobby: lobby })
  }).on('playersReady', function onPlayersReady() {
    self._updateJoinedLobby(lobby, { action: 'startGame' })
    // TODO(tec27): remove/transfer lobby
  })

  lobby.addPlayer(new LobbyPlayer(host, 'r'))
  this.io.sockets.in(LOBBY_LIST_CHANNEL)
      .emit(LOBBY_LIST_MESSAGE, { action: 'create', lobby: lobby })

  return lobby

  function onConnection(socket) {
    socket.emit('lobbies/join', lobby.name)
  }

  function onDisconnect() {
    lobby.removePlayer(host)
  }
}

LobbyHandler.prototype.create = function(socket, params, cb) {
  var user = this.io.users.get(socket)
  if (this.playerLobbyMap.has(user.name)) {
    return cb({ msg: 'You cannot enter multiple lobbies at once' })
  }

  if (!params.name || params.name == 'new') {
    return cb({ msg: 'Invalid name' })
  } else if (!params.map) {
    return cb({ msg: 'Invalid map' })
  } else if (!params.size || params.size < 2 || params.size > 8) {
    return cb({ msg: 'Invalid size' })
  }

  if (this.lobbyMap.has(params.name)) {
    return cb({ msg: 'A lobby with that name already exists' })
  }

  var lobby = this._doCreateLobby(user.name, params.name, params.map, params.size)
  if (lobby) {
    cb(null)
    user.except(socket).emit('lobbies/join', lobby.name)
  } else {
    cb({ msg: 'Error creating lobby' })
  }
}

LobbyHandler.prototype._updateJoinedLobby = function(lobby, msg) {
  this.io.users.in(lobby._socketChannel).emit('lobbies/joined/message', msg)
}

LobbyHandler.prototype.join = function(socket, params, cb) {
  var user = this.io.users.get(socket)
  if (!params.name || !this.lobbyMap.has(params.name)) {
    return cb({ msg: 'No lobby with that name exists' })
  } else if (this.playerLobbyMap.has(user.name)) {
    var oldLobby = this.playerLobbyMap.get(user.name)
    if (oldLobby.name == params.name) {
      return cb(null, oldLobby.getFullDescription())
    }

    return cb({ msg: 'You cannot enter multiple lobbies at once' })
  }

  var lobby = this.lobbyMap.get(params.name)
  if (lobby.size - lobby.numPlayers < 1) {
    return cb({ msg: 'Lobby full' })
  }

  var player = new LobbyPlayer(user.name, 'r')
  lobby.addPlayer(player)
  cb(null, lobby.getFullDescription())
  user.except(socket).emit('lobbies/join', lobby.name)
}

LobbyHandler.prototype.part = function(socket, cb) {
  var user = this.io.users.get(socket)
  if (!this.playerLobbyMap.has(user.name)) {
    return cb({ msg: 'You are not currently in a lobby' })
  }

  var lobby = this.playerLobbyMap.get(user.name)
    , slot = lobby.removePlayer(user.name)

  if (slot < 0) {
    cb({ msg: 'Error leaving lobby' })
  } else {
    cb(null)
    user.except(socket).emit('lobbies/part')
  }
}

LobbyHandler.prototype.chat = function(socket, params) {
  var user = this.io.users.get(socket)
  if (!params.msg || !this.playerLobbyMap.has(user.name)) {
    return
  }

  var lobby = this.playerLobbyMap.get(user.name)
  this._updateJoinedLobby(lobby, { action: 'chat', from: user.name, text: params.msg })
}

LobbyHandler.prototype.startCountdown = function(socket, cb) {
  var user = this.io.users.get(socket)
  if (!this.playerLobbyMap.has(user.name)) {
    return cb({ msg: 'You are not in a lobby' })
  }

  var lobby = this.playerLobbyMap.get(user.name)
    , player = lobby.getPlayer(user.name)
  if (!player || !lobby || lobby.host != player.name) {
    return cb({ msg: 'You must be the host to start the countdown' })
  }

  var self = this
  lobby.startCountdown(function() {
    self._updateJoinedLobby(lobby,
        { action: 'countdownComplete', host: socket.handshake.address.address, port: 6112 })
  })

  cb(null)
  this._updateJoinedLobby(lobby, { action: 'countdownStarted' })
}

LobbyHandler.prototype.readyUp = function(socket) {
  var user = this.io.users.get(socket)
  if (!this.playerLobbyMap.has(user.name)) {
    return
  }

  var lobby = this.playerLobbyMap.get(user.name)
  lobby.setPlayerReady(user.name)
}

function Lobby(name, map, size) {
  this.host = null
  this.name = name
  this.map = map
  this.size = size

  // Ideally Lobby would just be an EventEmitter itself, but it adds a bunch of properties that
  // would get stringified in JSON. To avoid that, we add it as a non-enumerable property
  Object.defineProperty(this, 'emitter',
      { value: new Emitter()
      , writable: false
      , enumerable: false
      })
  Object.defineProperty(this, 'slots',
      { value: new Array(size)
      , writable: false
      , enumerable: false
      })
  Object.defineProperty(this, 'players',
      { value: []
      , writable: false
      , enumerable: false
      })

  Object.defineProperty(this, 'numPlayers',
      { get: function() { return this.players.length }
      , enumerable: true
      })

  Object.defineProperty(this, '_socketChannel',
      { value: 'lobbies/joined/' + this.name
      , writable: false
      , enumerable: false
      })

  Object.defineProperty(this, '_isCountingDown',
      { value: false
      , writable: true
      , enumerable: false
      })

  Object.defineProperty(this, '_initializingGame',
      { value: false
      , writable: true
      , enumerable: false
      })

  Object.defineProperty(this, '_playerReadiness',
      { value: new Array(size)
      , writable: true
      , enumerable: false
      })
}

Lobby.prototype.addPlayer = function(player) {
  if (this.size - this.players.length < 1) {
    throw new Error('No space for player')
  }

  if (this.players.length === 0) {
    // this is the first player to join the lobby, must be the creator
    this.host = player.name
  }

  this.players.push(player)
  for (var i = 0; i < this.size; i++) {
    if (!this.slots[i]) {
      this.slots[i] = player
      this.emitter.emit('addPlayer', i, player)
      return i
    }
  }
}

Lobby.prototype.removePlayer = function(playerName) {
  var i
    , len
  for (i = 0, len = this.players.length; i < len; i++) {
    if (this.players[i].name == playerName) {
      this.players.splice(i, 1)
      break
    }
  }

  for (i = 0; i < this.size; i++) {
    if (this.slots[i] && this.slots[i].name == playerName) {
      var player = this.slots[i]
      this.slots[i] = undefined
      this.emitter.emit('removePlayer', i, player)
      break
    }
  }
  var slotNum = i < this.size ? i : -1

  if (!this.players.length) {
    // lobby is empty, close it down
    this.emitter.emit('closed')
  } else if (this.host == playerName) {
    // host left, pick a new host (earliest joiner)
    this.host = this.players[0].name
    this.emitter.emit('newHost', this.host)
  }

  return slotNum
}

Lobby.prototype.getPlayer = function(playerName) {
  for (var i = 0; i < this.size; i++) {
    if (!!this.slots[i] && this.slots[i].name == playerName) {
      return this.slots[i]
    }
  }
  return null
}

// Returns an object with the "full" description of this lobby, for giving to people that have
// joined it instead of just viewing it on the lobby list
Lobby.prototype.getFullDescription = function() {
  return  { host: this.host
          , name: this.name
          , map: this.map
          , size: this.size
          , slots: this.slots
          , players: this.players
          }
}

Lobby.prototype.startCountdown = function(cb) {
  this._initializingGame = false
  this._isCountingDown = true

  var self = this
  setTimeout(function() {
    self._isCountingDown = false
    self._initializingGame = true
    self._playerReadiness = new Array(self.size)
    cb()
  }, 5000)
}

Lobby.prototype.setPlayerReady = function(playerName) {
  var found = false
    , allReady = true
  for (var i = 0; i < this.size; i++) {
    if (!this.slots[i]) {
      continue
    }
    else if (!found && this.slots[i].name == playerName) {
      found = true
      this._playerReadiness[i] = true
    } else if (!this._playerReadiness[i]) {
      allReady = false
    }

    if (found && !allReady) break
  }

  if (allReady) {
    this.emitter.emit('playersReady')
  }
}

Lobby.compare = function(a, b) {
  return a.name.localeCompare(b.name)
}

function LobbyPlayer(name, race) {
  this.name = name
  this.race = race
}
