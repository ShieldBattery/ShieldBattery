var bindings = require('bindings')('bw')
  , bw = bindings()
  , EventEmitter = require('events').EventEmitter
  , path = require('path')
  , util = require('util')

var processInitialized = false
  , inLobby = false
  , inGame = false

util.inherits(BroodWar, EventEmitter)
function BroodWar(bindings) {
  EventEmitter.call(this)
  this.bindings = bindings
  this._lobby = new Lobby(bindings, this)

  var self = this
    , levels = [ 'verbose', 'debug', 'warning', 'error' ]
  bindings.onLog = function(logLevel, msg) {
    self.emit('log', levels[logLevel], msg)
  }
}

BroodWar.prototype._log = function(level, msg) {
  this.emit('log', level, msg)
}

BroodWar._gameCreationTimeout = 10000
BroodWar._gameJoinTimeout = 10000

// cb is func(err, lobby)
BroodWar.prototype.createLobby = function(playerName, gameSettings, cb) {
  cb = cb.bind(this)
  if (!processInitialized) {
    return cb(new Error('Process must be initialized first'))
  }
  if (inLobby || inGame) {
    return cb(new Error('Already in a lobby or game'))
  }

  this.bindings.isBroodWar = true
  this.bindings.localPlayerName = playerName
  if (!this.bindings.chooseNetworkProvider()) {
    return cb(new Error('Could not choose network provider'))
  }
  this.bindings.isMultiplayer = true

  if (!this.bindings.createGame(gameSettings)) {
    return cb(new Error('Could not create game'))
  }
  this.bindings.initGameNetwork()
  inLobby = true
  this._lobby.start()

  var self = this
  this._lobby.on('downloadStatus:0', initListener)
  var timeout = setTimeout(onTimeout, BroodWar._gameCreationTimeout)

  function onTimeout() {
    self._lobby.removeListener('downloadStatus:0', initListener)
    cb(new Error('Game creation timed out'))
  }

  function initListener(percent) {
    if (percent == 100) {
      self._lobby.removeListener('downloadStatus:0', initListener)
      clearTimeout(timeout)
      cb(null, self._lobby)
    } else {
      clearTimeout(timeout)
      setTimeout(onTimeout, BroodWar._gameCreationTimeout)
    }
  }
}

BroodWar.prototype.joinLobby = function(playerName, host, port, cb) {
  cb = cb.bind(this)
  if (!playerName || !host || !port || !cb) {
    return cb(new Error('Incorrect arguments'))
  }

  if (!processInitialized) {
    return cb(new Error('Process must be initialized first'))
  }
  if (inLobby || inGame) {
    return cb(new Error('Already in a lobby or game'))
  }

  this._log('verbose', 'Attempting to join lobby')

  this.bindings.isBroodWar = true
  this.bindings.localPlayerName = playerName
  if (!this.bindings.chooseNetworkProvider()) {
    return cb(new Error('Could not choose network provider'))
  }
  this.bindings.isMultiplayer = true

  this.bindings.spoofGame('shieldbattery', false, host, port)
  if (!this.bindings.joinGame()) {
    return cb(new Error('Could not join game'))
  }

  this.bindings.initGameNetwork()
  inLobby = true
  this._lobby.start()

  // TODO(tec27): we really need to handle the other events, like downloads and version
  // confirmation here so that we know when packets have been exchanged. The download status is
  // still, however, the final packet exchanged for a successful join
  var self = this
  this._lobby.on('downloadStatus:' + this.bindings.localLobbyId, initListener)
  var timeout = setTimeout(function() {
    self._lobby.removeListener('downloadStatus:' + self.bindings.localLobbyId, initListener)
    cb(new Error('Joining game timed out'))
  }, BroodWar._gameJoinTimeout)

  function initListener(percent) {
    if (percent == 100) {
      self._lobby.removeListener('downloadStatus:' + self.bindings.localLobbyId, initListener)
      clearTimeout(timeout)
      cb(null, self._lobby)
    }
  }
}

// cb is func()
BroodWar.prototype.initProcess = function(cb) {
  cb = cb.bind(this)
  if (processInitialized) {
    return cb()
  }
  var self = this
  this.bindings.initProcess(function(err) {
    if (err) return cb(err)

    self.bindings.isBroodWar = true
    self.bindings.initSprites(function(err) {
      processInitialized = true
      cb(err)
    })
  })
}

util.inherits(Lobby, EventEmitter)
function Lobby(bindings, bw) {
  EventEmitter.call(this)
  this.bw = bw
  this.bindings = bindings
  this._running = false
  this._onTurn = this._onTurn.bind(this)
  // we keep an internal event emitter for making interfacing with the binding callbacks simpler
  // without allowing external parties to remove our listeners. Pertinent events will be forwarded
  // on to the external emitter
  this._gameEmitter = new EventEmitter()
  this.slots = new Array(this.bindings.slots.length)

  var i
    , len
  for (i = 0, len = this.bindings.slots.length; i < len; i++) {
    this.slots[i] = new PlayerSlot(this.bindings.slots[i])
  }

  var self = this
  this.bindings.onLobbyDownloadStatus = function(slot, percent) {
    self._gameEmitter.emit('downloadStatus', slot, percent)
    self._gameEmitter.emit('downloadStatus:' + slot, percent)
    self.bw._log('debug', 'Slot ' + slot + ' is now at ' + percent + '% downloaded')
  }

  this.bindings.onLobbySlotChange = function(slot, stormId, type, race, team) {
    var info = { stormId: stormId, type: type, race: race, team: team }
    self._gameEmitter.emit('slotChange', slot, info)
    self._gameEmitter.emit('slotChange:' + slot, info)
    self.bw._log('debug', util.format('Slot %d changed:\tstormId: %d\ttype: %d\trace: %d\tteam: %d',
        slot, stormId, type, race, team))
  }

  this.bindings.onLobbyStartCountdown = function() {
    self._gameEmitter.emit('countdownStarted')
    self.bw._log('debug', 'Countdown started')
  }

  this.bindings.onLobbyGameInit = function(seed, playerBytes) {
    self._gameEmitter.emit('gameInit', seed, playerBytes)
    self.bw._log('debug', util.format('Game init happened. Seed: %d\tPlayers: [ %s ]',
        seed, playerBytes.join(' ')))
  }

  this.bindings.onLobbyMissionBriefing = function(slot) {
    self._gameEmitter.emit('missionBriefingEntered', slot)
    self.bw._log('debug', util.format('Slot %d entered mission briefing.', slot))
  }

  this.bindings.onLobbyChatMessage = function(slot, message) {
    self._gameEmitter.emit('chatMessage', slot, message)
    self.bw._log('debug', util.format('[Lobby] <%d>: %s', slot, message))
  }

  this._gameEmitter.on('downloadStatus', function(slot, percent) {
    self.emit('downloadStatus', slot, percent)
  }).on('countdownStarted', function() {
    self.emit('countdownStarted')
  }).on('chatMessage', function(slot, message) {
    self.emit('chatMessage', slot, message)
  }).on('gameInit', function(seed, playerBytes) {
    // TODO(tec27): get rid of this once the Lobby interface works better for starting a game
    self.emit('gameInit', seed, playerBytes)
  })

  function createForwarder(i) {
    self._gameEmitter.on('downloadStatus:' + i, function(percent) {
      self.emit('downloadStatus:' + i, percent)
    })
  }
  for (i = 0; i < 8; i++) {
    createForwarder(i)
  }
}

// turns will only be processed every 250ms, but data messages can be processed much faster
Lobby._turnTime = 25
Lobby._actionTimeout = 10000

Lobby.prototype.start = function() {
  if (this._running) return
  this._interval = setInterval(this._onTurn, Lobby._turnTime)
  this._running = true
}

Lobby.prototype.stop = function() {
  if (!this._running) return
  clearInterval(this._interval)
  ;delete this._interval
}

Lobby.prototype._onTurn = function() {
  this.bindings.processLobbyTurn()
  // TODO(tec27): when processing lobby turns we should probably be checking the lobby dirty
  // flag and refreshing our local caches if its true (and setting it back to false ;)
  // TODO(tec27): deal with return value here to know what data messages were processed
}

Lobby.prototype._ensureRunning = function(cb) {
  if (!this._running) {
    cb(new Error('Lobby not running'))
    return false
  }
  return true
}

// cb is func(err)
Lobby.prototype.addComputer = function(slot, cb) {
  if (!this._ensureRunning()) return
  // TODO(tec27): use slot info to do preemptive checking here
  if (!this.bindings.addComputer(slot)) {
    return cb(new Error('Could not add computer in slot ' + slot))
  }

  var event = 'slotChange:' + slot
    , self = this
  this._gameEmitter.on(event, changeListener)
  var timeout = setTimeout(function() {
    self._gameEmitter.removeListener(event, changeListener)
    cb(new Error('Adding computer in slot ' + slot + ' timed out'))
  }, Lobby._actionTimeout)

  function changeListener(info) {
    // TODO(tec27): provide a BW constants module for this shit
    if (info.stormId == 0xFF && info.type == 5) {
      clearTimeout(timeout)
      self._gameEmitter.removeListener(event, changeListener)
      cb(null)
    }
  }
}

// slot is optional (defaults to your slot)
// cb is func(err)
Lobby.prototype.setRace = function(slot, race, cb) {
  if (!this._ensureRunning()) return

  if (arguments.length < 3) {
    cb = race
    race = slot
    slot = this.bindings.localLobbyId
  }

  race = race.toLowerCase()
  var raceNum
  switch(race.charAt(0)) {
    case 'z': raceNum = 0; break;
    case 't': raceNum = 1; break;
    case 'p': raceNum = 2; break;
    default: raceNum = 6; break;
  }

  if (!this.bindings.setRace(slot, raceNum)) {
    return cb(new Error('Could not set race for slot ' + slot))
  }

  var event = 'slotChange:' + slot
    , self = this
  this._gameEmitter.on(event, changeListener)
  var timeout = setTimeout(function() {
    self._gameEmitter.removeListener(event, changeListener)
    cb(new Error('Setting race in slot ' + slot + ' timed out'))
  }, Lobby._actionTimeout)

  function changeListener(info) {
    if (info.race === raceNum) {
      clearTimeout(timeout)
      self._gameEmitter.removeListener(event, changeListener)
      cb(null)
    }
  }
}

// cb is func(err)
Lobby.prototype.startCountdown = function(cb) {
  // TODO(tec27): this is probably not really the function we want. Ideally we want something where
  // you just tell the lobby to start a game and it deals with countdown/init/briefing logistics
  // and returns a game EE or an error
  if (!this._ensureRunning()) return

  if (!this.bindings.startGameCountdown()) {
    return cb(new Error('Couldn\'t start countdown'))
  }

  var self = this
  this._gameEmitter.once('countdownStarted', listener)
  var timeout = setTimeout(function() {
    self._gameEmitter.removeListener('countdownStarted', listener)
    cb(new Error('Starting countdown timed out'))
  }, Lobby._actionTimeout)

  function listener() {
    clearTimeout(timeout)
    cb(null)
  }
}

// cb is func(err)
Lobby.prototype.runGameLoop = function(cb) {
  // TODO(tec27): see startCountdown note above
  if (!this._ensureRunning()) return

  this.bindings.runGameLoop(function() {
    cb(null)
  })

  this.stop()
  this.emit('gameStarted')
}

function def(context, name, getter) {
  Object.defineProperty(context, name,
      { get: getter
      , enumerable: true
      })
}

function PlayerSlot(nativeSlot) {
  this.nativeSlot = nativeSlot

  def(this, 'playerId', function() { return this.nativeSlot.playerId })
  def(this, 'stormId', function() { return this.nativeSlot.stormId })
  def(this, 'type', this._convertType)
  def(this, 'race', this._convertRace)
  def(this, 'team', function() { return this.nativeSlot.team })
  def(this, 'name', function() { return this.nativeSlot.name })
}

PlayerSlot.prototype._convertType = function() {
  switch (this.nativeSlot.type) {
    case 0: return 'none'
    case 1: return 'computer'
    case 2: return 'human'
    case 3: return 'rescuepassive'
    // case 4: unknown
    case 5: return 'lobbycomputer'
    case 6: return 'open'
    case 7: return 'neutral'
    case 8: return 'closed'
    case 9: return 'observer'
    case 10: return 'playerleft'
    case 11: return 'computerleft'
    default: return 'unknown'
  }
}

PlayerSlot.prototype._convertRace = function() {
  switch (this.nativeSlot.race) {
    case 0: return 'zerg'
    case 1: return 'terran'
    case 2: return 'protoss'
    case 6: return 'random'
    default: return 'unknown'
  }
}

module.exports = new BroodWar(bw)
