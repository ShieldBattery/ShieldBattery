var Emitter = require('events').EventEmitter
  , SimpleMap = require('../shared/simple-map')
  , listUtils = require('../shared/list-utils')
  , util = require('util')
  , cuid = require('cuid')

module.exports = function(nydus, userSockets) {
  return new LobbyHandler(nydus, userSockets)
}

function LobbyHandler(nydus, userSockets) {
  this.nydus = nydus
  this.userSockets = userSockets
  this.lobbyMap = new SimpleMap()
  this.lobbies = []
  // player -> their current lobby. Each player can be in at most one lobby at a time.
  this.playerLobbyMap = new SimpleMap()

  var self = this
    , basePath = '/lobbies'
  nydus.router.call(basePath + '/create', function(req, res, params) {
    self.create(req, res, params)
  }).call(basePath + '/:lobby/join', function(req, res) {
    self.join(req, res)
  }).call(basePath + '/:lobby/part/:playerId', function(req, res) {
    self.part(req, res)
  }).call(basePath + '/:lobby/addComputer', function(req, res) {
    self.addComputer(req, res)
  }).call(basePath + '/:lobby/setRace/:playerId', function(req, res, race) {
    self.setRace(req, res, race)
  }).call(basePath + '/:lobby/kick/:playerId', function(req, res) {
    self.kick(req, res)
  }).call(basePath + '/:lobby/startCountdown', function(req, res) {
    self.startCountdown(req, res)
  }).call(basePath + '/:lobby/readyUp/:playerId', function(req, res) {
    self.readyUp(req, res)
  }).subscribe(basePath, function(req, res) {
    // Anyone can listen to the lobby list at any time
    res.complete()
    var lobbyList = self.lobbies.map(function(lobby) {
      return lobby.$
    })
    req.socket.publish(basePath, { action: 'full', list: lobbyList })
  }).subscribe(basePath + '/:lobby', function(req, res) {
    self.subscribeLobby(req, res)
  }).publish(basePath + '/:lobby', function(req, event, complete) {
    self.sendChat(req, event, complete)
  })
}

LobbyHandler.prototype._doCreateLobby = function(host, name, map, size) {
  var lobby = new Lobby(name, map, size)
  this.lobbyMap.put(lobby.name, lobby)
  listUtils.sortedInsert(this.lobbies, lobby, Lobby.compare)

  var self = this
  lobby.on('addPlayer', function onAddPlayer(slot, player) {
    self._updateJoinedLobby(lobby, { action: 'join', slot: slot, player: player })
    if (!player.isComputer) {
      self.playerLobbyMap.put(player.name, lobby)
      var user = self.userSockets.get(player.name)
      user.once('disconnect', onDisconnect)
        .on('subscribe', publishLobby)
        .publish('lobby', { name: name })
    }
  }).on('removePlayer', function onRemovePlayer(slot, player, kick) {
    if (!player.isComputer) {
      self.playerLobbyMap.del(player.name)
      var user = self.userSockets.get(player.name)
      if (user) {
        user.removeListener('disconnect', onDisconnect)
          .removeListener('subscribe', publishLobby)
        // ensure they receive the part message, then revoke all subscriptions so they can't spy on
        // lobbies they're not in
        process.nextTick(function() {
          user.revoke(lobby._topic)
        })
      }
    }
    self._updateJoinedLobby(lobby, { action: kick ? 'kick' : 'part', id: player.id })
  }).on('newHost', function onNewHost(hostId, hostName) {
    self._updateJoinedLobby(lobby, { action: 'newHost', id: hostId, name: hostName })
    self.nydus.publish('/lobbies', { action: 'update', lobby: lobby.$ })
  }).on('closed', function onLobbyClosed() {
    self.lobbyMap.del(lobby.name)
    var index = self.lobbies.indexOf(lobby)
    if (index != -1) {
      self.lobbies.splice(index, 1)
    }
    self.nydus.publish('/lobbies', { action: 'remove', lobby: lobby.$ })
  }).on('playersReady', function onPlayersReady() {
    self._updateJoinedLobby(lobby, { action: 'startGame' })
    // TODO(tec27): remove/transfer lobby
  })

  lobby.addPlayer(new LobbyPlayer(host, 'r'))
  this.nydus.publish('/lobbies', { action: 'create', lobby: lobby.$ })

  return lobby

  function onDisconnect() {
    var player = lobby.findPlayerWithName(this.userName)
    lobby.removePlayer(player.id)
  }

  function publishLobby(user, socket) {
    user.publishTo(socket, 'lobby', { name: name })
  }
}

LobbyHandler.prototype.create = function(req, res, params) {
  var user = this.userSockets.get(req.socket)
  if (this.playerLobbyMap.has(user.userName)) {
    return res.fail(409, 'conflict', { msg: 'You cannot enter multiple lobbies at once' })
  }

  if (!params.name) {
    return res.fail(400, 'bad request', { msg: 'Invalid name' })
  } else if (!params.map) {
    return res.fail(400, 'bad request', { msg: 'Invalid map' })
  } else if (!params.size || params.size < 2 || params.size > 8) {
    return res.fail(400, 'bad request', { msg: 'Invalid size' })
  }

  if (this.lobbyMap.has(params.name)) {
    return res.fail(409, 'conflict', { msg: 'A lobby with that name already exists' })
  }

  this._doCreateLobby(user.userName, params.name, params.map, params.size)
  res.complete()
}

LobbyHandler.prototype._updateJoinedLobby = function(lobby, msg) {
  this.nydus.publish(lobby._topic, msg)
}

LobbyHandler.prototype.join = function(req, res) {
  var user = req.socket.handshake.userName
  if (!req.params.lobby || !this.lobbyMap.has(req.params.lobby)) {
    return res.fail(404, 'not found', { msg: 'No lobby with that name exists' })
  } else if (this.playerLobbyMap.has(user)) {
    var oldLobby = this.playerLobbyMap.get(user)
    if (oldLobby.name == req.params.lobby) {
      return res.complete(oldLobby.findPlayerWithName(user).id)
    }

    return res.fail(409, 'conflict', { msg: 'You cannot enter multiple lobbies at once' })
  }

  var lobby = this.lobbyMap.get(req.params.lobby)
  if (lobby.size - lobby.numPlayers < 1) {
    return res.fail(409, 'conflict', { msg: 'The lobby is full' })
  }

  var player = new LobbyPlayer(user, 'r')
  lobby.addPlayer(player)
  res.complete(player.id)
}

LobbyHandler.prototype.subscribeLobby = function(req, res) {
  // TODO(tec27): immediately publish lobby state to the socket
  var user = req.socket.handshake.userName
  if (!req.params.lobby || !this.lobbyMap.has(req.params.lobby)) {
    return res.fail(404, 'not found', { msg: 'No lobby with that name exists' })
  }
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to subscribe to it' })
  }

  var lobby = this.lobbyMap.get(req.params.lobby)
  if (this.playerLobbyMap.get(user) != lobby) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to subscribe to it' })
  }

  res.complete()
  req.socket.publish(lobby._topic, { action: 'update', lobby: lobby.getFullDescription() })
}

LobbyHandler.prototype.addComputer = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to add computer players' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (lobby.host != user) {
    return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to add computer players' })
  } else if (lobby.size - lobby.numPlayers < 1) {
    return res.fail(409, 'conflict', { msg: 'The lobby is full' })
  }

  var computer = new LobbyComputer('r')
  lobby.addPlayer(computer)
  res.complete()
}

LobbyHandler.prototype.setRace = function(req, res, race) {
  if (race != 'z' && race != 't' && race != 'p' && race != 'r') {
    return res.fail(400, 'bad request', { msg: 'Invalid race' })
  }

  var user = req.socket.handshake.userName
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(409, 'conflict', { msg: 'You must be in a lobby to set races' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (lobby.name != req.params.lobby) {
    return res.fail(403, 'forbidden', { msg: 'You cannot set races in a lobby you aren\'t in' })
  }
  var player = lobby.getPlayer(req.params.playerId)
  if (!player) {
    return res.fail(404, 'not found', { msg: 'No such user' })
  }
  if (!player.isComputer && player.name != user) {
    return res.fail(403, 'forbidden', { msg: 'You cannot set other users\'s races' })
  } else if (player.isComputer && lobby.host != user) {
    return res.fail(403, 'forbidden', { msg: 'Only the host can set computer races' })
  }

  player.race = race
  res.complete()
  this._updateJoinedLobby(lobby, { action: 'raceChange', id: player.id, race: player.race })
}

LobbyHandler.prototype.kick = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(409, 'conflict', { msg: 'You must be in a lobby to kick players' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (lobby.name != req.params.lobby) {
    return res.fail(403, 'forbidden', { msg: 'You cannot kick players in a lobby you aren\'t in' })
  }
  if (lobby.host != user) {
    return res.fail(403, 'forbidden', { msg: 'Only the host can kick players' })
  }
  var playerToKick = lobby.getPlayer(req.params.playerId)
  if (!playerToKick) {
    return res.fail(404, 'not found', { msg: 'No such user' })
  }
  if (playerToKick.name == user) {
    return res.fail(403, 'forbidden', { msg: 'You cannot kick yourself' })
  }

  var slot = lobby.removePlayer(playerToKick.id, true)
  if (slot < 0) {
    return res.fail(500, 'internal server error', { msg: 'Error removing user' })
  } else {
    return res.complete()
  }
}

LobbyHandler.prototype.part = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(409, 'conflict', { msg: 'You are not currently in a lobby' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (req.params.lobby != lobby.name) {
    return res.fail(403, 'forbidden', { msg: 'You cannot leave a lobby you are not in' })
  }
  var player = lobby.getPlayer(req.params.playerId)
  if (!player || player.name != user) {
    return res.fail(403, 'forbidden', { msg: 'You cannot part for other users' })
  }
  var slot = lobby.removePlayer(req.params.playerId)

  if (slot < 0) {
    return res.fail(500, 'internal server error', { msg: 'Error removing user' })
  } else {
    return res.complete()
  }
}

LobbyHandler.prototype.sendChat = function(req, event, complete) {
  var user = req.socket.handshake.userName
  if (event.action != 'chat' || event.text === undefined) {
    return
  }
  if (!this.playerLobbyMap.has(user)) {
    return
  }

  var lobby = this.playerLobbyMap.get(user)
  if (req.params.lobby != lobby.name) {
    return
  }

  complete({ action: 'chat', from: user, text: event.text })
}

LobbyHandler.prototype.startCountdown = function(req, res) {
  var user = req.socket.handshake.userName
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to start the countdown' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (!lobby || req.params.lobby != lobby.name || lobby.host != user) {
    return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to start the countdown' })
  }

  var self = this
  lobby.startCountdown(function() {
    self._updateJoinedLobby(lobby,
        { action: 'countdownComplete', host: req.socket.handshake.address.address, port: 6112 })
  })

  res.complete()
  this._updateJoinedLobby(lobby, { action: 'countdownStarted' })
}

LobbyHandler.prototype.readyUp = function(req, res) {
  var user = req.socket.handshake.userName
    , playerId = req.params.playerId
  if (!this.playerLobbyMap.has(user)) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to ready up' })
  }

  var lobby = this.playerLobbyMap.get(user)
  if (!lobby || req.params.lobby != lobby.name) {
    return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to ready up' })
  }
  var player = lobby.getPlayer(playerId)
  if (!player || player.name != user) {
    return res.fail(403, 'forbidden', { msg: 'You can only ready up yourself' })
  }

  lobby.setPlayerReady(playerId)
  return res.complete()
}

function Lobby(name, map, size) {
  Emitter.call(this)
  this.host = null
  this.hostId = null
  this.name = name
  this.map = map
  this.size = size

  this.slots = new Array(size)
  this.players = []
  this._topic = '/lobbies/' + encodeURIComponent(this.name)
  this._isCountingDown = false
  this._initializingGame = false
  this._playerReadiness = new Array(size)

  Object.defineProperty(this, 'numPlayers',
      { get: function() { return this.players.length }
      , enumerable: true
      })

  // Property representing the serialized data to send to clients
  this.$ = new SerializedLobby(this)
}
util.inherits(Lobby, Emitter)

function SerializedLobby(lobby) {
  Object.defineProperty(this, 'host',
      { get: function() { return lobby.host }
      , enumerable: true
      })
  Object.defineProperty(this, 'hostId',
      { get: function() { return lobby.hostId }
      , enumerable: true
      })
  this.name = lobby.name
  this.map = lobby.map
  this.size = lobby.size

  Object.defineProperty(this, 'numPlayers',
      { get: function() { return lobby.players.length }
      , enumerable: true
      })
}

Lobby.prototype.addPlayer = function(player) {
  if (this.size - this.players.length < 1) {
    throw new Error('No space for player')
  }

  if (this.players.length === 0) {
    // this is the first player to join the lobby, must be the creator
    this.host = player.name
    this.hostId = player.id
  }

  this.players.push(player)
  for (var i = 0; i < this.size; i++) {
    if (!this.slots[i]) {
      this.slots[i] = player
      this.emit('addPlayer', i, player)
      return i
    }
  }
}

Lobby.prototype.removePlayer = function(id, kick) {
  var i
    , len
  for (i = 0, len = this.players.length; i < len; i++) {
    if (this.players[i].id == id) {
      this.players.splice(i, 1)
      break
    }
  }

  for (i = 0; i < this.size; i++) {
    if (this.slots[i] && this.slots[i].id == id) {
      var player = this.slots[i]
      this.slots[i] = undefined
      this.emit('removePlayer', i, player, !!kick)
      break
    }
  }
  var slotNum = i < this.size ? i : -1
  var nonCompCount = 0
  for (i = 0; i < this.players.length; i++) {
    if (!this.players[i].isComputer) nonCompCount++
  }

  if (!nonCompCount) {
    // lobby is empty, close it down
    this.emit('closed')
  } else if (this.hostId == id) {
    // host left, pick a new host (earliest joiner)
    for (i = 0; i < this.players.length; i++) {
      if (this.players[i].isComputer) continue

      this.host = this.players[i].name
      this.hostId = this.players[i].id
      this.emit('newHost', this.hostId, this.host)
      break
    }
  }

  return slotNum
}

Lobby.prototype.getPlayer = function(id) {
  for (var i = 0; i < this.size; i++) {
    if (!!this.slots[i] && this.slots[i].id == id) {
      return this.slots[i]
    }
  }
  return null
}

Lobby.prototype.findPlayerWithName = function(name) {
  for (var i = 0; i < this.size; i++) {
    if (!!this.slots[i] && this.slots[i].name == name && !this.slots[i].isComputer) {
      return this.slots[i]
    }
  }
  return null
}

// Returns an object with the "full" description of this lobby, for giving to people that have
// joined it instead of just viewing it on the lobby list
Lobby.prototype.getFullDescription = function() {
  return  { host: this.host
          , hostId: this.hostId
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

Lobby.prototype.setPlayerReady = function(id) {
  var found = false
    , allReady = true
  for (var i = 0; i < this.size; i++) {
    if (!this.slots[i]) {
      continue
    }
    else if (!found && !this.slots[i].isComputer && this.slots[i].id == id) {
      found = true
      this._playerReadiness[i] = true
    } else if (!this._playerReadiness[i] && !this.slots[i].isComputer) {
      allReady = false
    }

    if (found && !allReady) break
  }

  if (allReady) {
    this.emit('playersReady')
  }
}

Lobby.compare = function(a, b) {
  return a.name.localeCompare(b.name)
}

function LobbyMember(name, race, isComputer) {
  this.id = cuid.slug()
  this.name = name
  this.race = race
  this.isComputer = !!isComputer
}

function LobbyPlayer(name, race) {
  LobbyMember.call(this, name, race, false)
}
util.inherits(LobbyPlayer, LobbyMember)

function LobbyComputer(race) {
  LobbyMember.call(this, 'Computer', race, true)
}
util.inherits(LobbyComputer, LobbyMember)
