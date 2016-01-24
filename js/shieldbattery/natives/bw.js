import { EventEmitter } from 'events'
import handleChat from './chat-handler'
const bindings = process._linkedBinding('shieldbattery_bw')
const bw = bindings.init()

// TODO(tec27): use a decorator? Or just write a toJSON implementation to avoid the need for
// changing the prop descriptor?
function def(context, name, getter) {
  Object.defineProperty(context, name, { get: getter, enumerable: true })
}

class PlayerSlot {
  constructor(nativeSlot) {
    this.nativeSlot = nativeSlot

    def(this, 'playerId', () => this.nativeSlot.playerId)
    def(this, 'stormId', () => this.nativeSlot.stormId)
    def(this, 'type', () => this._convertType)
    def(this, 'race', () => this._convertRace)
    def(this, 'team', () => this.nativeSlot.team)
    def(this, 'name', () => this.nativeSlot.name)
  }

  _convertType() {
    switch (this.nativeSlot.type) {
      case 0: return 'none'
      case 1: return 'computer'
      case 2: return 'human'
      case 3: return 'rescuepassive'
      case 4: return 'rescueactive'
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

  _convertRace() {
    switch (this.nativeSlot.race) {
      case 0: return 'zerg'
      case 1: return 'terran'
      case 2: return 'protoss'
      case 3: return 'other'
      case 4: return 'unused'
      case 5: return 'select'
      case 6: return 'random'
      default: return 'unknown'
    }
  }
}

class Lobby extends EventEmitter {
  // turns will only be processed every 250ms, but data messages can be processed much faster
  static _turnTime = 25;
  static _actionTimeout = 10000;

  constructor(bindings, bw) {
    super()
    this.bw = bw
    this.bindings = bindings
    this._running = false
    this._onTurn = ::this._onTurn
    // we keep an internal event emitter for making interfacing with the binding callbacks simpler
    // without allowing external parties to remove our listeners. Pertinent events will be forwarded
    // on to the external emitter
    this._gameEmitter = new EventEmitter()
    this._interval = null

    this._makeSlots()
    this._setupEventHandlers()
  }

  _makeSlots() {
    this.slots = this.bindings.slot.map(nativeSlot => new PlayerSlot(nativeSlot))
  }

  _setupEventHandlers() {
    this.bindings.onLobbyDownloadStatus = (slot, percent) => {
      this._gameEmitter.emit('downloadStatus', slot, percent)
      this._gameEmitter.emit('downloadStatus:' + slot, percent)
      this.bw._log('debug', 'Slot ' + slot + ' is now at ' + percent + '% downloaded')
    }

    this.bindings.onLobbySlotChange = (slot, stormId, type, race, team) => {
      const info = { stormId, type, race, team }
      this._gameEmitter.emit('slotChange', slot, info)
      this._gameEmitter.emit('slotChange:' + slot, info)
      this.bw._log('debug',
          `Slot ${slot} changed:\tstormId: ${stormId}\ttype: ${type}\trace: ${race}\tteam: ${team}`)
    }

    this.bindings.onLobbyStartCountdown = () => {
      this._gameEmitter.emit('countdownStarted')
      this.bw._log('debug', 'Countdown started')
    }

    this.bindings.onLobbyGameInit = (seed, playerBytes) => {
      this._gameEmitter.emit('gameInit', seed, playerBytes)
      this.bw._log('debug',
          `Game init happened. Seed: ${seed}\tPlayers: [ ${playerBytes.join(' ')} ]`)
    }

    this.bindings.onLobbyMissionBriefing = slot => {
      this._gameEmitter.emit('missionBriefingEntered', slot)
      this.bw._log('debug', `Slot ${slot} entered mission briefing.`)
    }

    this.bindings.onLobbyChatMessage = (slot, message) => {
      this._gameEmitter.emit('chatMessage', slot, message)
      this.bw._log('debug', `[Lobby] <${slot}>: ${message}`)
    }

    this.bindings.onMenuErrorDialog = message => {
      this.bw._log('error', 'BW Error: ' + message)
    }

    this._gameEmitter
      .on('downloadStatus', (slot, percent) => this.emit('downloadStatus', slot, percent))
      .on('countdownStarted', () => this.emit('countdownStarted'))
      .on('chatMessage', (slot, message) => this.emit('chatMessage', slot, message))
      // TODO(tec27): get rid of this once the Lobby interface works better for starting a game
      .on('gameInit', (seed, playerBytes) => this.emit('gameInit', seed, playerBytes))

    const createForwarder = i => {
      this._gameEmitter
        .on('downloadStatus:' + i, percent => this.emit('downloadStatus:' + i, percent))
    }
    for (let i = 0; i < 8; i++) {
      createForwarder(i)
    }
  }

  start() {
    if (this._running) return
    this._interval = setInterval(this._onTurn, Lobby._turnTime)
    this._running = true
  }

  stop() {
    if (!this._running) return
    clearInterval(this._interval)
    this._interval = null
  }

  _onTurn() {
    this.bindings.processLobbyTurn()
    // TODO(tec27): when processing lobby turns we should probably be checking the lobby dirty
    // flag and refreshing our local caches if its true (and setting it back to false ;)
    // TODO(tec27): deal with return value here to know what data messages were processed
  }

  _ensureRunning(cb) {
    if (!this._running) {
      cb(new Error('Lobby not running'))
      return false
    }
    return true
  }

  // cb is func(err)
  addComputer(slot, cb) {
    if (!this._ensureRunning()) return undefined
    // TODO(tec27): use slot info to do preemptive checking here
    if (!this.bindings.addComputer(slot)) {
      return cb(new Error('Could not add computer in slot ' + slot))
    }

    const event = 'slotChange:' + slot
    let timeout
    const changeListener = info => {
      // TODO(tec27): provide a BW constants module for this shit
      if (info.stormId === 0xFF && info.type === 5) {
        clearTimeout(timeout)
        this._gameEmitter.removeListener(event, changeListener)
        cb(null)
      }
    }
    timeout = setTimeout(() => {
      this._gameEmitter.removeListener(event, changeListener)
      cb(new Error('Adding computer in slot ' + slot + ' timed out'))
    }, Lobby._actionTimeout)
    this._gameEmitter.on(event, changeListener)
  }

  // slot is optional (defaults to your slot)
  // cb is func(err)
  setRace(slot, race, cb) {
    if (!this._ensureRunning()) return undefined

    if (arguments.length < 3) {
      cb = race
      race = slot
      slot = this.bindings.localLobbyId
    }

    race = race.toLowerCase()
    let raceNum
    switch (race.charAt(0)) {
      case 'z': raceNum = 0; break
      case 't': raceNum = 1; break
      case 'p': raceNum = 2; break
      default: raceNum = 6; break
    }

    if (!this.bindings.setRace(slot, raceNum)) {
      return cb(new Error('Could not set race for slot ' + slot))
    }

    const event = 'slotChange:' + slot
    let timeout
    const changeListener = info => {
      if (info.race === raceNum) {
        clearTimeout(timeout)
        this._gameEmitter.removeListener(event, changeListener)
        cb(null)
      }
    }
    timeout = setTimeout(function() {
      this._gameEmitter.removeListener(event, changeListener)
      cb(new Error('Setting race in slot ' + slot + ' timed out'))
    }, Lobby._actionTimeout)
    this._gameEmitter.on(event, changeListener)
  }

  // cb is func(err)
  startCountdown(cb) {
    // TODO(tec27): this is probably not really the function we want. Ideally we want something
    // where you just tell the lobby to start a game and it deals with countdown/init/briefing
    // logistics and returns a game EE or an error
    if (!this._ensureRunning()) return undefined

    if (!this.bindings.startGameCountdown()) {
      return cb(new Error('Couldn\'t start countdown'))
    }

    let timeout
    const listener = () => {
      clearTimeout(timeout)
      cb(null)
    }
    timeout = setTimeout(function() {
      this._gameEmitter.removeListener('countdownStarted', listener)
      cb(new Error('Starting countdown timed out'))
    }, Lobby._actionTimeout)
    this._gameEmitter.once('countdownStarted', listener)
  }

  // cb is func(err)
  runGameLoop(cb) {
    // TODO(tec27): see startCountdown note above
    if (!this._ensureRunning()) return

    this.bindings.runGameLoop(cb)

    this.stop()
    this.emit('gameStarted')
  }
}

let processInitialized = false
let inLobby = false

class BroodWar extends EventEmitter {
  static _gameCreationTimeout = 10000;
  static _gameJoinTimeout = 10000;

  constructor(bindings) {
    super()
    this.bindings = bindings
    this._lobby = new Lobby(bindings, this)

    this._setupLogging()
    this.chatHandler = handleChat(this)
  }

  // Kept outside of the constructor to deal with arrow-functions+super issues in babel
  _setupLogging() {
    const levels = [ 'verbose', 'debug', 'warning', 'error' ]
    bindings.onLog = (logLevel, msg) => this.emit('log', levels[logLevel], msg)
  }

  setSettings(settings) {
    this.bindings.setSettings(settings)
  }

  _log(level, msg) {
    this.emit('log', level, msg)
  }

  // cb is func(err, lobby)
  createLobby(playerName, gameSettings, cb) {
    cb = cb.bind(this)
    if (!processInitialized) {
      return cb(new Error('Process must be initialized first'))
    }
    if (inLobby) {
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

    let initListener
    const onTimeout = () => {
      this._lobby.removeListener('downloadStatus:0', initListener)
      cb(new Error('Game creation timed out'))
    }
    const timeout = setTimeout(onTimeout, BroodWar._gameCreationTimeout)
    initListener = percent => {
      if (percent === 100) {
        this._lobby.removeListener('downloadStatus:0', initListener)
        clearTimeout(timeout)
        cb(null, this._lobby)
      } else {
        clearTimeout(timeout)
        setTimeout(onTimeout, BroodWar._gameCreationTimeout)
      }
    }
    this._lobby.on('downloadStatus:0', initListener)
  }

  joinLobby(playerName, host, port, cb) {
    cb = cb.bind(this)
    if (!playerName || !host || !port || !cb) {
      return cb(new Error('Incorrect arguments'))
    }

    if (!processInitialized) {
      return cb(new Error('Process must be initialized first'))
    }
    if (inLobby) {
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
    let timeout
    const initListener = percent => {
      if (percent === 100) {
        this._lobby.removeListener('downloadStatus:' + this.bindings.localLobbyId, initListener)
        clearTimeout(timeout)
        cb(null, this._lobby)
      }
    }
    this._lobby.on('downloadStatus:' + this.bindings.localLobbyId, initListener)
    timeout = setTimeout(() => {
      this._lobby.removeListener('downloadStatus:' + this.bindings.localLobbyId, initListener)
      cb(new Error('Joining game timed out'))
    }, BroodWar._gameJoinTimeout)
  }

  // cb is func()
  initProcess(cb) {
    cb = cb.bind(this)
    if (processInitialized) {
      this._log('verbose', 'Already initialized')
      return cb()
    }
    this.bindings.initProcess(err => {
      if (err) return cb(err)

      this.bindings.isBroodWar = true
      this.bindings.initSprites(function(err) {
        if (!err) {
          processInitialized = true
        }
        cb(err)
      })
    })
  }

  // type is 'all', 'allies', or 'player'
  // recipients is only necessary for players, and is a bitfield (8 bits) representing who the
  //   message should be sent to
  sendChatMessage(message, type, recipients) {
    if (arguments.length < 2) {
      throw new Error('Incorrect arguments')
    }

    let typeNum
    switch (type) {
      case 'all': typeNum = 2; break
      case 'allies': typeNum = 3; break
      default: typeNum = 4
    }
    if (typeNum === 4 && (arguments.length < 3 || (recipients | 0) > 256)) {
      throw new Error('Incorrect arguments')
    }

    this.bindings.sendMultiplayerChatMessage(message, typeNum, recipients)
  }

  // Displays a message (in the chat area), doesn't send to any other players
  displayIngameMessage(message, timeout) {
    if (arguments.length < 1) {
      throw new Error('Incorrect arguments')
    }

    timeout = timeout || 0
    this.bindings.displayIngameMessage(message, timeout)
  }

  cleanUpForExit(cb) {
    this.bindings.cleanUpForExit(cb)
  }
}


export default new BroodWar(bw)
