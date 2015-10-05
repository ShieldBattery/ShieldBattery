import { EventEmitter as Emitter } from 'events'
import SimpleMap from '../../shared/simple-map'
import listUtils from '../../shared/list-utils'
import cuid from 'cuid'

class SerializedLobby {
  constructor(lobby) {
    Object.defineProperty(this, 'host', {
      get() { return lobby.host },
      enumerable: true,
    })
    Object.defineProperty(this, 'hostId', {
      get() { return lobby.hostId },
      enumerable: true,
    })
    this.name = lobby.name
    this.map = lobby.map
    this.size = lobby.size

    Object.defineProperty(this, 'numPlayers', {
      get() { return lobby.players.length },
      enumerable: true,
    })
  }
}

class LobbyMember {
  constructor(name, race, isComputer) {
    this.id = cuid.slug()
    this.name = name
    this.race = race
    this.isComputer = !!isComputer
  }
}

class LobbyPlayer extends LobbyMember {
  constructor(name, race) {
    super(name, race, false)
  }
}

class LobbyComputer extends LobbyMember {
  constructor(race) {
    super('Computer', race, true)
  }
}

class Lobby extends Emitter {
  constructor(name, map, size) {
    super()
    this.host = null
    this.hostId = null
    this.name = name
    this.map = map
    this.size = size

    this.slots = new Array(size)
    this.players = []
    this._topic = '/lobbies/' + encodeURIComponent(this.name)
    this._startCountdownTimer = null
    this._isCountingDown = false
    this._isInitializingGame = false
    this._playerReadiness = new Array(size)

    Object.defineProperty(this, 'numPlayers', {
      get() { return this.players.length },
      enumerable: true
    })

    // Property representing the serialized data to send to clients
    this.$ = new SerializedLobby(this)
  }

  addPlayer(player) {
    if (this.size - this.players.length < 1) {
      throw new Error('No space for player')
    }

    if (!this.players.length) {
      // this is the first player to join the lobby, must be the creator
      this.host = player.name
      this.hostId = player.id
    }

    this.players.push(player)
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        this.slots[i] = player
        this.emit('addPlayer', i, player)
        return i
      }
    }
  }

  removePlayer(id, kick) {
    for (let i = 0; i < this.players.length; i++) {
      if (this.players[i].id === id) {
        this.players.splice(i, 1)
        break
      }
    }

    let slotNum = -1
    for (let i = 0; i < this.size; i++) {
      if (this.slots[i] && this.slots[i].id === id) {
        const player = this.slots[i]
        this.slots[i] = null
        slotNum = i
        this.emit('removePlayer', i, player, !!kick)
        break
      }
    }

    if (this._isCountingDown) {
      this.abortCountdown()
    }
    if (this._isInitializingGame) {
      this.abortInitialization()
    }

    let nonCompCount = 0
    for (const player of this.players) {
      if (player.isComputer) {
        nonCompCount += 1
      }
    }

    if (!nonCompCount) {
      // lobby is empty, close it down
      this.emit('closed')
    } else if (this.hostId === id) {
      // host left, pick a new host (earliest joiner)
      for (const player of this.players) {
        if (player.isComputer) continue

        this.host = player.name
        this.hostId = player.id
        this.emit('newHost', this.hostId, this.host)
        break
      }
    }

    return slotNum
  }

  getPlayer(id) {
    for (const slot of this.slots) {
      if (slot && slot.id === id) {
        return slot
      }
    }
    return null
  }

  findPlayerWithName(name) {
    for (const slot of this.slots) {
      if (slot && slot.name === name && !slot.isComputer) {
        return slot
      }
    }
    return null
  }

  // Returns an object with the "full" description of this lobby, for giving to people that have
  // joined it instead of just viewing it on the lobby list
  getFullDescription() {
    return {
      host: this.host,
      hostId: this.hostId,
      name: this.name,
      map: this.map,
      size: this.size,
      slots: this.slots,
      players: this.players,
    }
  }

  startCountdown(cb) {
    this._isCountingDown = true
    this._isInitializingGame = false

    this._startCountdownTimer = setTimeout(() => {
      this._isCountingDown = false
      this._isInitializingGame = true
      this._playerReadiness = new Array(this.size)
      cb()
    }, 5000)
  }

  abortCountdown() {
    clearTimeout(this._startCountdownTimer)
    this._isCountingDown = false
    this._isInitializingGame = false
    this.emit('countdownAborted')
  }

  abortInitialization() {
    clearTimeout(this._startCountdownTimer)
    this._isCountingDown = false
    this._isInitializingGame = false
    this.emit('initializationAborted')
  }

  setPlayerReady(id) {
    let found = false
      , allReady = true
    for (let i = 0; i < this.size; i++) {
      if (!this.slots[i]) {
        continue
      } else if (!found && !this.slots[i].isComputer && this.slots[i].id === id) {
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

  isJoinable() {
    return !(this._isCountingDown || this._isInitializingGame)
  }

  static compare(a, b) {
    return a.name.localeCompare(b.name)
  }
}

class LobbyHandler {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.lobbyMap = new SimpleMap()
    this.lobbies = []
    // player -> their current lobby. Each player can be in at most one lobby at a time.
    this.playerLobbyMap = new SimpleMap()

    // TODO(tec27): fix for new nydus
    // const basePath = '/lobbies'
    /* nydus.router
      .call(basePath + '/create', (req, res, params) => this.create(req, res, params))
      .call(basePath + '/:lobby/join', (req, res) => this.join(req, res))
      .call(basePath + '/:lobby/part/:playerId', (req, res) => this.part(req, res))
      .call(basePath + '/:lobby/addComputer', (req, res) => this.addComputer(req, res))
      .call(basePath + '/:lobby/setRace/:playerId',
          (req, res, race) => this.setRace(req, res, race))
      .call(basePath + '/:lobby/kick/:playerId', (req, res) => this.kick(req, res))
      .call(basePath + '/:lobby/startCountdown', (req, res) => this.startCountdown(req, res))
      .call(basePath + '/:lobby/readyUp/:playerId', (req, res) => this.readyUp(req, res))
      .subscribe(basePath, (req, res) => {
        // Anyone can listen to the lobby list at any time
        res.complete()
        const lobbyList = this.lobbies.map(lobby => lobby.$)
        req.socket.publish(basePath, { action: 'full', list: lobbyList })
      })
      .subscribe(basePath + '/:lobby', (req, res) => this.subscribeLobby(req, res))
      .publish(basePath + '/:lobby', (req, event, complete) => this.sendChat(req, event, complete))
    */
  }

  _doCreateLobby(host, name, map, size) {
    const lobby = new Lobby(name, map, size)
    this.lobbyMap.put(lobby.name, lobby)
    listUtils.sortedInsert(this.lobbies, lobby, Lobby.compare)

    lobby.on('addPlayer', (slot, player) => {
      this._updateJoinedLobby(lobby, { action: 'join', slot, player })
      if (!player.isComputer) {
        this.playerLobbyMap.put(player.name, lobby)
        const user = this.userSockets.get(player.name)
        user.once('disconnect', onDisconnect)
          .on('subscribe', publishLobby)
          .publish('lobby', { name })
      }
    }).on('removePlayer', (slot, player, kick) => {
      if (!player.isComputer) {
        this.playerLobbyMap.del(player.name)
        const user = this.userSockets.get(player.name)
        if (user) {
          user.removeListener('disconnect', onDisconnect)
            .removeListener('subscribe', publishLobby)
          // ensure they receive the part message, then revoke all subscriptions so they can't spy
          // on lobbies they're not in
          process.nextTick(function() {
            user.revoke(lobby._topic)
          })
        }
      }
      this._updateJoinedLobby(lobby, { action: kick ? 'kick' : 'part', id: player.id })
    }).on('newHost', (hostId, hostName) => {
      this._updateJoinedLobby(lobby, { action: 'newHost', id: hostId, name: hostName })
      this.nydus.publish('/lobbies', { action: 'update', lobby: lobby.$ })
    }).on('closed', () => {
      this.lobbyMap.del(lobby.name)
      const index = this.lobbies.indexOf(lobby)
      if (index !== -1) {
        this.lobbies.splice(index, 1)
      }
      this.nydus.publish('/lobbies', { action: 'remove', lobby: lobby.$ })
    }).on('countdownAborted', () => {
      this._updateJoinedLobby(lobby, { action: 'countdownAborted' })
    }).on('initializationAborted', () => {
      this._updateJoinedLobby(lobby, { action: 'initializationAborted' })
    }).on('playersReady', () => {
      // TODO(tec27): remove/transfer lobby
      this._updateJoinedLobby(lobby, { action: 'startGame' })
    })

    lobby.addPlayer(new LobbyPlayer(host, 'r'))
    this.nydus.publish('/lobbies', { action: 'create', lobby: lobby.$ })

    return lobby

    function onDisconnect() {
      const player = lobby.findPlayerWithName(this.userName)
      lobby.removePlayer(player.id)
    }

    function publishLobby(user, socket) {
      user.publishTo(socket, 'lobby', { name })
    }
  }

  create(req, res, params) {
    const user = this.userSockets.get(req.socket)
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

  _updateJoinedLobby(lobby, msg) {
    this.nydus.publish(lobby._topic, msg)
  }

  join(req, res) {
    const user = req.socket.handshake.userName
    if (!req.params.lobby || !this.lobbyMap.has(req.params.lobby)) {
      return res.fail(404, 'not found', { msg: 'No lobby with that name exists' })
    } else if (this.playerLobbyMap.has(user)) {
      const oldLobby = this.playerLobbyMap.get(user)
      if (oldLobby.name === req.params.lobby) {
        return res.complete(oldLobby.findPlayerWithName(user).id)
      }

      return res.fail(409, 'conflict', { msg: 'You cannot enter multiple lobbies at once' })
    }

    const lobby = this.lobbyMap.get(req.params.lobby)
    if (lobby.size - lobby.numPlayers < 1) {
      return res.fail(409, 'conflict', { msg: 'The lobby is full' })
    }
    if (!lobby.isJoinable()) {
      return res.fail(409, 'conflict', { msg: 'The lobby is not joinable' })
    }

    const player = new LobbyPlayer(user, 'r')
    lobby.addPlayer(player)
    res.complete(player.id)
  }

  subscribeLobby(req, res) {
    const user = req.socket.handshake.userName
    if (!req.params.lobby || !this.lobbyMap.has(req.params.lobby)) {
      return res.fail(404, 'not found', { msg: 'No lobby with that name exists' })
    }
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to subscribe to it' })
    }

    const lobby = this.lobbyMap.get(req.params.lobby)
    if (this.playerLobbyMap.get(user) !== lobby) {
      return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to subscribe to it' })
    }

    res.complete()
    req.socket.publish(lobby._topic, { action: 'update', lobby: lobby.getFullDescription() })
  }

  addComputer(req, res) {
    const user = req.socket.handshake.userName
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to add computer players' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (lobby.host !== user) {
      return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to add computer players' })
    } else if (lobby.size - lobby.numPlayers < 1) {
      return res.fail(409, 'conflict', { msg: 'The lobby is full' })
    }

    const computer = new LobbyComputer('r')
    lobby.addPlayer(computer)
    res.complete()
  }

  setRace(req, res, race) {
    if (race !== 'z' && race !== 't' && race !== 'p' && race !== 'r') {
      return res.fail(400, 'bad request', { msg: 'Invalid race' })
    }

    const user = req.socket.handshake.userName
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(409, 'conflict', { msg: 'You must be in a lobby to set races' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (lobby.name !== req.params.lobby) {
      return res.fail(403, 'forbidden', { msg: 'You cannot set races in a lobby you aren\'t in' })
    }
    const player = lobby.getPlayer(req.params.playerId)
    if (!player) {
      return res.fail(404, 'not found', { msg: 'No such user' })
    }
    if (!player.isComputer && player.name !== user) {
      return res.fail(403, 'forbidden', { msg: 'You cannot set other users\'s races' })
    } else if (player.isComputer && lobby.host !== user) {
      return res.fail(403, 'forbidden', { msg: 'Only the host can set computer races' })
    }

    player.race = race
    res.complete()
    this._updateJoinedLobby(lobby, { action: 'raceChange', id: player.id, race: player.race })
  }

  kick(req, res) {
    const user = req.socket.handshake.userName
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(409, 'conflict', { msg: 'You must be in a lobby to kick players' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (lobby.name !== req.params.lobby) {
      return res.fail(403, 'forbidden',
          { msg: 'You cannot kick players in a lobby you aren\'t in' })
    }
    if (lobby.host !== user) {
      return res.fail(403, 'forbidden', { msg: 'Only the host can kick players' })
    }
    const playerToKick = lobby.getPlayer(req.params.playerId)
    if (!playerToKick) {
      return res.fail(404, 'not found', { msg: 'No such user' })
    }
    if (playerToKick.name === user) {
      return res.fail(403, 'forbidden', { msg: 'You cannot kick yourself' })
    }

    const slot = lobby.removePlayer(playerToKick.id, true)
    if (slot < 0) {
      return res.fail(500, 'internal server error', { msg: 'Error removing user' })
    } else {
      return res.complete()
    }
  }

  part(req, res) {
    const user = req.socket.handshake.userName
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(409, 'conflict', { msg: 'You are not currently in a lobby' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (req.params.lobby !== lobby.name) {
      return res.fail(403, 'forbidden', { msg: 'You cannot leave a lobby you are not in' })
    }
    const player = lobby.getPlayer(req.params.playerId)
    if (!player || player.name !== user) {
      return res.fail(403, 'forbidden', { msg: 'You cannot part for other users' })
    }
    const slot = lobby.removePlayer(req.params.playerId)

    if (slot < 0) {
      return res.fail(500, 'internal server error', { msg: 'Error removing user' })
    } else {
      return res.complete()
    }
  }

  sendChat(req, event, complete) {
    const user = req.socket.handshake.userName
    if (event.action !== 'chat' || event.text == null) {
      return
    }
    if (!this.playerLobbyMap.has(user)) {
      return
    }

    const lobby = this.playerLobbyMap.get(user)
    if (req.params.lobby !== lobby.name) {
      return
    }

    complete({ action: 'chat', from: user, text: event.text })
  }

  startCountdown(req, res) {
    const user = req.socket.handshake.userName
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to start the countdown' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (!lobby || req.params.lobby !== lobby.name || lobby.host !== user) {
      return res.fail(403, 'forbidden', { msg: 'You must be a lobby host to start the countdown' })
    }

    lobby.startCountdown(() => this._updateJoinedLobby(lobby,
        { action: 'countdownComplete', host: req.socket.handshake.address.address, port: 6112 }))

    res.complete()
    this._updateJoinedLobby(lobby, { action: 'countdownStarted' })
  }

  readyUp(req, res) {
    const user = req.socket.handshake.userName
    const playerId = req.params.playerId
    if (!this.playerLobbyMap.has(user)) {
      return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to ready up' })
    }

    const lobby = this.playerLobbyMap.get(user)
    if (!lobby || req.params.lobby !== lobby.name) {
      return res.fail(403, 'forbidden', { msg: 'You must be in a lobby to ready up' })
    }
    const player = lobby.getPlayer(playerId)
    if (!player || player.name !== user) {
      return res.fail(403, 'forbidden', { msg: 'You can only ready up yourself' })
    }

    lobby.setPlayerReady(playerId)
    return res.complete()
  }
}

export default function(nydus, userSockets) {
  return new LobbyHandler(nydus, userSockets)
}
