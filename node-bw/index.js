var bindings = require('bindings')('bw')
  , bw = bindings()
  , EventEmitter = require('events').EventEmitter
  , path = require('path')
  , util = require('util')

var processInitialized = false
  , inLobby = false
  , inGame = false

function BroodWar(bindings) {
  this.bindings = bindings
  this._lobby = new Lobby(bindings)
}

BroodWar._gameCreationTimeout = 10000
BroodWar._gameJoinTimeout = 10000

// cb is func(err, lobby)
BroodWar.prototype.createLobby = function(playerName, gameSettings, cb) {
  cb = cb.bind(this)
  if (!processInitialized) {
    return setImmediate(function() { cb(new Error('Process must be initialized first')) })
  }
  if (inLobby || inGame) {
    return setImmediate(function() { cb(new Error('Already in a lobby or game')) })
  }

  this.bindings.isBroodWar = true
  this.bindings.initSprites()
  this.bindings.localPlayerName = playerName
  this.bindings.chooseNetworkProvider()
  this.bindings.isMultiplayer= true

  if (!this.bindings.createGame(gameSettings)) {
    return setImmediate(function() { cb(new Error('Could not create game')) })
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

BroodWar.prototype.joinLobby = function(playerName, address, port, cb) {
  if (!playerName || !address || !port || !cb) {
    return setImmediate(function() { cb(new Error('Incorrect arguments')) })
  }

  cb = cb.bind(this)
  if (!processInitialized) {
    return setImmediate(function() { cb(new Error('Process must be initialized first')) })
  }
  if (inLobby || inGame) {
    return setImmediate(function() { cb(new Error('Already in a lobby or game')) })
  }

  console.log('attempting to join lobby...')

  this.bindings.isBroodWar = true
  this.bindings.initSprites()
  this.bindings.localPlayerName = playerName
  if (!this.bindings.chooseNetworkProvider()) {
    return setImmediate(function() { cb(new Error('Could not choose network provider')) })
  }
  this.bindings.isMultiplayer = true

  this.bindings.spoofGame('shieldbattery', false, address, port)
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

// cb is func(err)
BroodWar.prototype.loadPlugin = function(pluginPath, cb) {
  pluginPath = path.resolve(pluginPath)
  this.bindings.loadPlugin(pluginPath, cb.bind(module.exports))
}

// cb if func()
BroodWar.prototype.initProcess = function(cb) {
  if (processInitialized) {
    setImmediate(function() { cb() })
  }
  this.bindings.initProcess(cb.bind(this))
  processInitialized = true
}

util.inherits(Lobby, EventEmitter)
function Lobby(bindings) {
  EventEmitter.call(this)
  this.bindings = bindings
  this._running = false
  this._onTurn = this._onTurn.bind(this)
  // we keep an internal event emitter for making interfacing with the binding callbacks simpler
  // without allowing external parties to remove our listeners. Pertinent events will be forwarded
  // on to the external emitter
  this._gameEmitter = new EventEmitter()

  var self = this
  this.bindings.onLobbyDownloadStatus = function(slot, percent) {
    self._gameEmitter.emit('downloadStatus', slot, percent)
    self._gameEmitter.emit('downloadStatus:' + slot, percent)
    console.log('Slot ' + slot + ' is now at ' + percent + '% downloaded')
  }

  this.bindings.onLobbySlotChange = function(slot, stormId, type, race, team) {
    var info = { stormId: stormId, type: type, race: race, team: team }
    self._gameEmitter.emit('slotChange', slot, info)
    self._gameEmitter.emit('slotChange:' + slot, info)
    console.log('Slot %d changed:\tstormId: %d\ttype: %d\trace: %d\tteam: %d', slot, stormId, type,
        race, team)
  }

  this.bindings.onLobbyStartCountdown = function() {
    self._gameEmitter.emit('countdownStarted')
    console.log('Countdown started')
  }

  this.bindings.onLobbyGameInit = function(seed, playerBytes) {
    self._gameEmitter.emit('gameInit', seed, playerBytes)
    console.log('Game init happened. Seed: %d\tPlayers: [ %s ]', seed, playerBytes.join(' '))
  }

  this.bindings.onLobbyMissionBriefing = function(slot) {
    self._gameEmitter.emit('missionBriefingEntered', slot)
    console.log('Slot %d entered mission briefing.', slot)
  }

  this.bindings.onLobbyChatMessage = function(slot, message) {
    self._gameEmitter.emit('chatMessage', slot, message)
    console.log('[Lobby] <%d>: %s', slot, message)
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
  for (var i = 0; i < 8; i++) {
    createForwarder(i)
  }
}

Lobby._turnTime = 250
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
    setImmediate(function() { cb(new Error('Lobby not running')) })
    return false
  }
  return true
}

// cb is func(err)
Lobby.prototype.addComputer = function(slot, cb) {
  if (!this._ensureRunning()) return
  // TODO(tec27): when we have a cache of the current slot states we could do more preemptive
  // checking here
  if (!this.bindings.addComputer(slot)) {
    return setImmediate(function() { cb(new Error('Could not add computer in slot ' + slot)) })
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
    return setImmediate(function() { cb(new Error('Could not set race for slot ' + slot)) })
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
    return setImmediate(function() { cb(new Error('Couldn\'t start countdown')) })
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

module.exports = new BroodWar(bw)
