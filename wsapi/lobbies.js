var Emitter = require('events').EventEmitter
  , Endpoint = require('../util/websocket-endpoint')
  , SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')
  , util = require('util')

module.exports = function(io) {
  return new LobbyHandler(io)
}

// TODO(tec27): Its theoretically possible to get these maps back into LobbyHandler as instance
// variables and remove some of this global state. I'd like to do this when convenient. I believe
// it should be easier after we do a better job of mapping sockets to players throughout the
// application (e.g. each player gets their own namespace that we use to send them messages) instead
// of having a one-off solution for lobbies.
var lobbyMap = new SimpleMap()
  , lobbies = []
    // player -> their current lobby. Each player can be in at most one lobby at a time.
  , playerLobbyMap = new SimpleMap()
    // player -> all their active sockets in lobbies (effectively player+lobby -> socket, since we
    // only allow players to be in a single lobby across all active sessions)
  , playerSockets = new SimpleMap()

function LobbyHandler(io) {
  Endpoint.call(this, io, 'lobbies')
}
util.inherits(LobbyHandler, Endpoint)

var LOBBY_LIST_CHANNEL = 'lobbies/list'
  , LOBBY_LIST_MESSAGE = 'lobbies/message'
LobbyHandler.prototype.subscribe = function(socket, cb) {
  socket.join(LOBBY_LIST_CHANNEL)
  cb(lobbies)
}

LobbyHandler.prototype.unsubscribe = function(socket) {
  socket.leave(LOBBY_LIST_CHANNEL)
}

LobbyHandler.prototype._addSocketForPlayer = function(socket, playerName) {
  if (!playerSockets.has(playerName)) {
    playerSockets.put(playerName, [ socket ])
  } else {
    var sockets = playerSockets.get(playerName)
    if (sockets.indexOf(socket) != -1) return // socket already in the list

    sockets.push(socket)
  }

  socket.on('disconnect', lobbyDisconnectListener)
}

LobbyHandler.prototype._clearSocketsForPlayer = function(playerName) {
  if (!playerSockets.has(playerName)) return

  var sockets = playerSockets.get(playerName)
  playerSockets.del(playerName)
  for (var i = 0, len = sockets.length; i < len; i++) {
    sockets[i].removeListener('disconnect', lobbyDisconnectListener)
  }
}

LobbyHandler.prototype._doCreateLobby = function(host, name, map, size) {
  var lobby = new Lobby(name, map, size)
  lobbyMap.put(lobby.name, lobby)
  listUtils.sortedInsert(lobbies, lobby, Lobby.compare)

  var self = this
  lobby.emitter.on('addPlayer', function onAddPlayer(slot, player) {
    self._updateJoinedLobby(lobby, { action: 'join', slot: slot, player: player })
    playerLobbyMap.put(player.name, lobby)
    ;(playerSockets.get(player.name) || []).forEach(function(socket) {
      socket.join(lobby._socketChannel)
    })
  }).on('removePlayer', function onRemovePlayer(slot, player) {
    playerLobbyMap.del(player.name)
    ;(playerSockets.get(player.name) || []).forEach(function(socket) {
      socket.leave(lobby._socketChannel)
    })
    self._updateJoinedLobby(lobby, { action: 'part', slot: slot })
  }).on('newHost', function onNewHost(playerName) {
    self._updateJoinedLobby(lobby, { action: 'newHost', name: playerName })
    self.io.sockets.in(LOBBY_LIST_CHANNEL)
        .emit(LOBBY_LIST_MESSAGE, { action: 'update', lobby: lobby })
  }).on('closed', function onLobbyClosed() {
    lobbyMap.del(lobby.name)
    var index = lobbies.indexOf(lobby)
    if (index != -1) {
      lobbies.splice(index, 1)
    }
    self.io.sockets.in(LOBBY_LIST_CHANNEL)
        .emit(LOBBY_LIST_MESSAGE, { action: 'remove', lobby: lobby })
  })

  lobby.addPlayer(new LobbyPlayer(host, 'r'))
  this.io.sockets.in(LOBBY_LIST_CHANNEL)
      .emit(LOBBY_LIST_MESSAGE, { action: 'create', lobby: lobby })

  return lobby
}

LobbyHandler.prototype.create = function(socket, params, cb) {
  if (playerLobbyMap.has(socket.handshake.userName)) {
    return cb({ msg: 'You cannot enter multiple lobbies at once' })
  }

  if (!params.name || params.name == 'new') {
    return cb({ msg: 'Invalid name' })
  } else if (!params.map) {
    return cb({ msg: 'Invalid map' })
  } else if (!params.size || params.size < 2 || params.size > 8) {
    return cb({ msg: 'Invalid size' })
  }

  if (lobbyMap.has(params.name)) {
    return cb({ msg: 'A lobby with that name already exists' })
  }

  var host = socket.handshake.userName
    , lobby = this._doCreateLobby(host, params.name, params.map, params.size)
  if (lobby) {
    this._addSocketForPlayer(socket, host)
    socket.join(lobby._socketChannel)
    cb(null)
  } else {
    cb({ msg: 'Error creating lobby' })
  }
}

LobbyHandler.prototype._updateJoinedLobby = function(lobby, msg) {
  this.io.sockets.in(lobby._socketChannel).emit('lobbies/joined/message', msg)
}

function lobbyDisconnectListener() {
  var name = this.handshake.userName
  if (!playerSockets.has(name)) return

  var sockets = playerSockets.get(name)
  if (sockets.length == 1 && sockets[0] === this) {
    // no active sockets left, remove this user from whatever lobby they were in
    playerSockets.del(name)
    if (playerLobbyMap.has(name)) {
      playerLobbyMap.get(name).removePlayer(name)
    }
    return
  }

  // Find the socket in the list, and remove it. There are still some active sockets left, so until
  // they disconnect we will keep them in the lobby.
  for (var i = 0, len = sockets.length; i < len; i++) {
    if (sockets[i] === this) {
      sockets.splice(i, 1)
    }
  }
}

LobbyHandler.prototype.join = function(socket, params, cb) {
  var self = this
  if (!params.name || !lobbyMap.has(params.name)) {
    return cb({ msg: 'No lobby with that name exists' })
  } else if (playerLobbyMap.has(socket.handshake.userName)) {
    var oldLobby = playerLobbyMap.get(socket.handshake.userName)
    if (oldLobby.name == params.name) {
      // trying to join a lobby they're already in, simply return them the lobby info
      self._addSocketForPlayer(socket, socket.handshake.userName)
      socket.join(oldLobby._socketChannel)
      return cb(null, oldLobby.getFullDescription())
    }

    return cb({ msg: 'You cannot enter multiple lobbies at once' })
  }

  var lobby = lobbyMap.get(params.name)
  if (lobby.size - lobby.numPlayers < 1) {
    return cb({ msg: 'Lobby full' })
  }

  var player = new LobbyPlayer(socket.handshake.userName, 'r')
  self._addSocketForPlayer(socket, player.name)
  lobby.addPlayer(player)
  cb(null, lobby.getFullDescription())
}

// TODO(tec27): when a lobby has no players left in it, close it down. Also deal with hosts
LobbyHandler.prototype.part = function(socket, cb) {
  if (!playerLobbyMap.has(socket.handshake.userName)) {
    return cb({ msg: 'You are not currently in a lobby' })
  }

  var userName = socket.handshake.userName
    , lobby = playerLobbyMap.get(userName)
    , slot = lobby.removePlayer(userName)

  if (slot < 0) {
    cb({ msg: 'Error leaving lobby' })
  } else {
    cb(null)
  }
}

LobbyHandler.prototype.chat = function(socket, params) {
  if (!params.msg || !playerLobbyMap.has(socket.handshake.userName)) {
    return
  }

  var lobby = playerLobbyMap.get(socket.handshake.userName)
    , userName = socket.handshake.userName
  this._updateJoinedLobby(lobby, { action: 'chat', from: userName, text: params.msg })
}

LobbyHandler.prototype.startCountdown = function(socket, cb) {
  if (!playerLobbyMap.has(socket.handshake.userName)) {
    return cb({ msg: 'You are not in a lobby' })
  }

  var lobby = playerLobbyMap.get(socket.handshake.userName)
    , player = lobby.getPlayer(socket.handshake.userName)
  if (!player || !lobby || !lobby.host == player.name) {
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
    if (!!this.slots[i] && this.slots[i].name == playerName) {
      var player = this.slots[i]
      this.slots[i] = undefined
      this.emitter.emit('removePlayer', i, player)
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
  this._isCountingDown = true
  setTimeout(cb, 5000)
}

Lobby.compare = function(a, b) {
  return a.name.localeCompare(b.name)
}

function LobbyPlayer(name, race) {
  this.name = name
  this.race = race
}
