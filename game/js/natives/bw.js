import { EventEmitter } from 'events'
import handleChat from './chat-handler'
const bindings = process._linkedBinding('shieldbattery_bw')
const bw = bindings.init()

const PLAYER_TYPES = {
  0: 'none',
  1: 'computer',
  2: 'human',
  3: 'rescuepassive',
  4: 'rescueactive',
  5: 'lobbycomputer',
  6: 'open',
  7: 'neutral',
  8: 'closed',
  9: 'observer',
  10: 'playerleft',
  11: 'computerleft',
}
for (const key of Object.keys(PLAYER_TYPES)) {
  PLAYER_TYPES[PLAYER_TYPES[key]] = key
}

const PLAYER_RACES = {
  0: 'zerg',
  1: 'terran',
  2: 'protoss',
  3: 'other',
  4: 'unused',
  5: 'select',
  6: 'random',
}
for (const key of Object.keys(PLAYER_RACES)) {
  PLAYER_RACES[PLAYER_RACES[key]] = key
}

class PlayerSlot {
  constructor(nativeSlot) {
    this.nativeSlot = nativeSlot
  }

  get playerId() {
    return this.nativeSlot.playerId & 0xff
  }

  set playerId(id) {
    this.nativeSlot.playerId = id & 0xff
  }

  get stormId() {
    return this.nativeSlot.stormId & 0xff
  }

  set stormId(id) {
    this.nativeSlot.stormId = id & 0xff
  }

  get type() {
    return PLAYER_TYPES[this.nativeSlot.type]
  }

  set type(newType) {
    this.nativeSlot.type = PLAYER_TYPES[newType]
  }

  get typeId() {
    return this.nativeSlot.type
  }

  set typeId(newType) {
    this.nativeSlot.type = newType
  }

  get race() {
    return PLAYER_RACES[this.nativeSlot.race]
  }

  set race(newRace) {
    this.nativeSlot.race = PLAYER_RACES[newRace]
  }

  get team() {
    return this.nativeSlot.team & 0xff
  }

  set team(newTeam) {
    this.nativeSlot.team = newTeam & 0xff
  }

  get name() {
    return this.nativeSlot.name
  }

  set name(newName) {
    this.nativeSlot.name = newName
  }

  toJSON() {
    return {
      playerId: this.playerId,
      stormId: this.stormId,
      type: this.type,
      race: this.race,
      team: this.team,
      name: this.name,
    }
  }
}

let processInitialized = false
let inLobby = false

class BroodWar extends EventEmitter {
  constructor(bindings) {
    super()
    this.bindings = bindings
    this.slots = this.bindings.slots.map(nativeSlot => new PlayerSlot(nativeSlot))
    const levels = ['verbose', 'debug', 'warning', 'error']
    this.bindings.onLog = (logLevel, msg) => this.emit('log', levels[logLevel], msg)
    this.bindings.onReplaySave = replayPath => this.emit('replaySave', replayPath)
    this.bindings.onNetPlayerJoin = stormId => this.emit('netPlayerJoin', stormId)
    this.chatHandler = handleChat(this)
  }

  setSettings(settings) {
    this.bindings.setSettings(settings)
  }

  _log(level, msg) {
    this.emit('log', level, msg)
  }

  setName(playerName) {
    this.bindings.localPlayerName = playerName
  }

  initNetwork() {
    if (!this.bindings.chooseNetworkProvider()) {
      throw new Error('Could not choose network provider')
    }
    this.bindings.isMultiplayer = true
  }

  tickleLobbyNetwork() {
    this.bindings.tickleLobbyNetwork()
  }

  getStormPlayerNames() {
    return this.bindings.getStormPlayerNames()
  }

  doLobbyGameInit(seed, stormIdsToInit, playerBytes) {
    this.bindings.doLobbyGameInit(seed, stormIdsToInit, playerBytes)
  }

  async createLobby(gameSettings) {
    if (!processInitialized) {
      throw new Error('Process must be initialized first')
    }
    if (inLobby) {
      throw new Error('Already in a lobby or game')
    }

    if (!this.bindings.createGame(gameSettings)) {
      throw new Error('Could not create game')
    }
    this.bindings.initGameNetwork()
    inLobby = true
  }

  async joinLobby(mapPath, host, port, bwGameInfo) {
    if (!processInitialized) {
      throw new Error('Process must be initialized first')
    }
    if (inLobby) {
      throw new Error('Already in a lobby or game')
    }

    this._log('verbose', 'Attempting to join lobby')

    this.bindings.spoofGame('shieldbattery', false, host, port)
    const isJoined = await new Promise(resolve => {
      this.bindings.joinGame(mapPath, bwGameInfo, resolve)
    })
    if (!isJoined) {
      throw new Error('Could not join game')
    }

    this.bindings.initGameNetwork()
    inLobby = true
  }

  async initProcess() {
    if (processInitialized) {
      return
    }

    await new Promise((resolve, reject) => {
      this.bindings.initProcess(err => (err ? reject(err) : resolve()))
    })
    this.bindings.isBroodWar = true
    await new Promise((resolve, reject) => {
      this.bindings.initSprites(err => (err ? reject(err) : resolve()))
    })
    processInitialized = true
  }

  async runGameLoop() {
    this.emit('gameStarted')

    return new Promise((resolve, reject) => {
      this.bindings.runGameLoop((err, results, time) => {
        inLobby = false
        if (err) reject(err)
        else resolve({ results, time })
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
      case 'all':
        typeNum = 2
        break
      case 'allies':
        typeNum = 3
        break
      default:
        typeNum = 4
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
    if (!processInitialized) {
      // cleaning up for exit is only necessary if any initialization has happened
      process.nextTick(cb)
    } else {
      this.bindings.cleanUpForExit(cb)
    }
  }
}

export default new BroodWar(bw)
