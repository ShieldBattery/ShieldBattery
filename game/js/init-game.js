import { List } from 'immutable'
import RallyPoint from 'rally-point-player'
import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import { setRallyPoint, setNetworkRoutes } from './natives/snp'
import * as gameTypes from './game-types'
import createDeferred from '../../app/common/async/deferred'
import rejectOnTimeout from '../../app/common/async/reject-on-timeout'
import { isUms } from '../../app/common/lobbies'
import {
  GAME_STATUS_AWAITING_PLAYERS,
  GAME_STATUS_ERROR,
  GAME_STATUS_STARTING,
} from '../../app/common/game-status'

forge.on('startWndProc', () => log.verbose('forge\'s wndproc pump started'))
  .on('endWndProc', () => log.verbose('forge\'s wndproc pump finished'))

function getBwRace(lobbyRace) {
  switch (lobbyRace) {
    case 'z': return 'zerg'
    case 't': return 'terran'
    case 'p': return 'protoss'
    default: return 'random'
  }
}

const CREATION_TIMEOUT = 10000
const JOIN_TIMEOUT = 10000

class GameInitializer {
  constructor(socket, { lobby, settings, setup, localUser, localMap }) {
    this.socket = socket
    this.lobbyConfig = lobby
    this.settings = settings
    this.setup = setup
    this.localUser = localUser
    this.localMap = localMap
    this.rallyPoint = new RallyPoint('::', 0)
    this.routes = null

    this.routesPromise = createDeferred()
  }

  setRoutes(routes) {
    this.routes = routes
    this.routesPromise.resolve()
  }

  buildMappings(rallyPointRoutes) {
    // Build an object mapping Fake-IP => rally-point route, ordered consistently between all
    // players (host first, then all other players ordered by slot). Computers are not included, as
    // we [obviously] won't be sending network traffic to them. This mapping will be used by our
    // SNP to shuttle packets back and forth from Storm while:
    // - Keeping consistent IPs/ports between all players of the game (even though they might differ
    //   due to NAT, LAN, etc.)
    // - Allowing us to easily get references to active rally-point routes
    const slots = new List(this.lobbyConfig.slots)
    const players = slots.filter(slot => slot.type === 'human' || slot.type === 'observer')
    const hostId = this.lobbyConfig.host.id
    const ordered = players.filter(p => p.id === hostId)
        .concat(players.filterNot(p => p.id === hostId))
    const routesById = new Map(rallyPointRoutes.map(r => [ r.forId, r.route ]))
    const netInfos = ordered.map(p => routesById.get(p.id))
    return netInfos.toKeyedSeq().mapKeys(i => `10.27.27.${i}`).toJS()
  }

  async joinRoutes() {
    const rallyPoint = this.rallyPoint
    // For each route, ping the IPv4 and IPv6 endpoints. Whichever ping comes back first, send the
    // join request to that address. (We expect both to take about the same amount of time, but this
    // will remove any addresses we can't talk to, e.g. IPv6 when we only have an IPv4 address).
    const slots = this.lobbyConfig.slots
    const joinPromises = this.routes.map(async route => {
      const port = route.server.port
      let chosenAddress
      for (let i = 0; !chosenAddress && i < 3; i++) {
        // TODO(tec27): Potential optimization, find all unique servers in the whole route set and
        // ping them at once, then look the results up for each route
        const pingPromises = []
        if (route.server.address4) {
          pingPromises.push(rallyPoint.pingServers([{ address: route.server.address4, port }]))
        }
        if (route.server.address6) {
          pingPromises.push(rallyPoint.pingServers([{ address: route.server.address6, port }]))
        }
        const [ pingResult ] = await Promise.race(pingPromises)

        if (pingResult.time < Number.MAX_VALUE) {
          chosenAddress = pingResult.server.address
        }
      }

      if (!chosenAddress) {
        throw new Error(`Could not reach rally-point server: ${JSON.stringify(route.server)}`)
      }

      const joined = await rallyPoint.joinRoute(
          { address: chosenAddress, port }, route.routeId, route.playerId)
      const destPlayer = slots.find(slot => slot.id === route.for)
      log.verbose(
          `Connected to ${route.server.desc} for player ${destPlayer.name} [${route.routeId}]`)
      return { route: joined, forId: route.for }
    })
    const readyPromises = joinPromises.map(async joinPromise => {
      const { route, forId } = await joinPromise
      await route.untilReady()
      log.verbose(`Route [${route.routeId}] is ready`)
      return { route, forId }
    })

    let keepAlive = true
    // Keep routes alive while we wait for all of them to connect
    joinPromises.map(async joinPromise => {
      const { route } = await joinPromise
      await new Promise(resolve => setTimeout(resolve, 500))

      while (keepAlive) {
        route.keepAlive()
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    })

    try {
      return await Promise.all(readyPromises)
    } finally {
      keepAlive = false
    }
  }

  async run() {
    // TODO(tec27): handle global settings?
    bw.setSettings(this.settings.local)

    if (!forge.inject()) {
      throw new Error('forge injection failed')
    }
    log.verbose('forge injected')

    await bw.initProcess()
    log.verbose('process initialized')
    forge.runWndProc()

    const myName = this.localUser.name

    bw.setName(myName)
    await this.rallyPoint.bind()
    setRallyPoint(this.rallyPoint)
    bw.initNetwork()

    const isHost = this.lobbyConfig.host.name === myName
    if (isHost) {
      log.verbose('creating lobby for map: ' + this.localMap)
      await this.createLobby()
    }

    log.verbose('waiting for game routes')
    await this.routesPromise
    log.verbose('routes received, joining routes')
    const rallyPointRoutes = await this.joinRoutes()
    setNetworkRoutes(this.buildMappings(rallyPointRoutes))

    if (!isHost) {
      log.verbose('joining lobby with map: ' + this.localMap)
      await this.joinLobby()
    }

    this.notifyProgress(GAME_STATUS_AWAITING_PLAYERS)
    log.verbose('in lobby, setting up slots')

    const tickleInterval = setInterval(() => bw.tickleLobbyNetwork(), 100)
    try {
      this.setupSlots()
      await this.waitForPlayers()
    } finally {
      clearInterval(tickleInterval)
    }

    this.notifyProgress(GAME_STATUS_STARTING)
    log.verbose('setting game seed')
    const stormNames = bw.getStormPlayerNames()
    const playerNameToStormId = name => {
      const idx = stormNames.findIndex(x => x === name)
      if (idx === -1) {
        throw new Error(`${name} does not have storm id`)
      }
      return idx
    }
    const stormPlayerIds = this.lobbyConfig.slots
        .filter(slot => slot.type === 'human' || slot.type === 'observer')
        .map(p => playerNameToStormId(p.name))
    // TODO(tec27): deal with player bytes if we ever allow save games
    bw.doLobbyGameInit(this.setup.seed | 0, stormPlayerIds, [ 8, 8, 8, 8, 8, 8, 8, 8 ])
    forge.endWndProc()

    const mySlot = this.lobbyConfig.slots.find(x => x.name === myName)
    if (mySlot && mySlot.type === 'observer') {
      const observerStormIds = this.lobbyConfig.slots
          .filter(slot => slot.type === 'observer')
          .map(p => playerNameToStormId(p.name))
      bw.chatHandler.overrideAllies(observerStormIds)
    }
    this.socket.invoke('/game/start')
    const { results, time } = await bw.runGameLoop()
    log.verbose('gameResults: ' + JSON.stringify(results))
    log.verbose('gameTime: ' + time)
    await this.socket.invoke('/game/end', { results, time })

    bw.cleanUpForExit(() => setTimeout(() => process.exit(), 100))
  }

  notifyProgress(state, extra = null) {
    this.socket.invoke('/game/setupProgress', { status: { state, extra } })
  }

  async createLobby() {
    const { gameType, gameSubType } = this.lobbyConfig
    const params = {
      mapPath: this.localMap,
      gameType: gameTypes[gameType](gameSubType),
    }
    await rejectOnTimeout(bw.createLobby(params), CREATION_TIMEOUT, 'Creating lobby timed out')
  }

  async joinLobby() {
    let succeeded = false
    const tilesetNameToId = {
      badlands: 0,
      platform: 1,
      installation: 2,
      ashworld: 3,
      jungle: 4,
      desert: 5,
      ice: 6,
      twilight: 7,
    }

    const { gameType, gameSubType } = this.lobbyConfig
    const gameTypeValue = gameTypes[gameType](gameSubType)
    const bwGameInfo = {
      gameName: this.lobbyConfig.name,
      numSlots: this.lobbyConfig.slots.length,
      numPlayers: this.lobbyConfig.slots
          .filter(slot => slot.type === 'human' || slot.type === 'observer').length,
      mapName: this.lobbyConfig.map.name,
      mapTileset: tilesetNameToId[this.lobbyConfig.map.tileset],
      mapWidth: this.lobbyConfig.map.width,
      mapHeight: this.lobbyConfig.map.height,
      gameType: gameTypeValue & 0xFFFF,
      gameSubtype: (gameTypeValue >> 16) & 0xFFFF,
    }

    while (!succeeded) {
      try {
        await rejectOnTimeout(bw.joinLobby(this.localMap, '10.27.27.0', 6112, bwGameInfo),
            JOIN_TIMEOUT, 'Joining lobby timed out')
        succeeded = true
      } catch (err) {
        log.error(`Error joining lobby: ${err}, retrying...`)
        // Give some time for I/O to happen, since promises are essentially process.nextTick timing
        await new Promise(resolve => setTimeout(resolve, 30))
      }
    }

    bw.tickleLobbyNetwork() // Run through a turn once, so that we ensure Storm has init'd its names
    log.verbose(`storm player names at join: ${JSON.stringify(bw.getStormPlayerNames())}`)
  }

  async waitForPlayers() {
    const players = this.lobbyConfig.slots
        .filter(slot => slot.type === 'human')
        .map(p => p.name)
    const observers = this.lobbyConfig.slots
        .filter(slot => slot.type === 'observer')
        .map(p => p.name)

    const hasAllPlayers = () => {
      const playerSlots = bw.slots.filter(s => s.type === 'human')
      const waitingFor = players.filter(p => !playerSlots.find(s => s.name === p && s.stormId < 8))

      const stormNames = bw.getStormPlayerNames()
      const observerWaitingFor = observers.filter(o => !stormNames.find(name => name === o))
      if (!waitingFor.length && !observerWaitingFor.length) {
        return true
      } else {
        const allWaiting = waitingFor.concat(observerWaitingFor)
        this.notifyProgress(GAME_STATUS_AWAITING_PLAYERS, allWaiting)
        log.debug(`Waiting for players: ${allWaiting.join(', ')}`)
        return false
      }
    }

    return new Promise(resolve => {
      this.updateSlots()
      if (hasAllPlayers()) {
        resolve()
        return
      }

      const onPlayerJoin = () => {
        this.updateSlots()
        if (hasAllPlayers()) {
          bw.removeListener('netPlayerJoin', onPlayerJoin)
          resolve()
        }
      }
      bw.on('netPlayerJoin', onPlayerJoin)
    })
  }

  mapSlotTypes(type) {
    switch (type) {
      case 'human':
      case 'observer':
        return 'human'
      case 'computer':
        return 'lobbycomputer'
      case 'controlledOpen':
      case 'controlledClosed':
      case 'open':
      case 'closed':
        return 'open'
      default:
        return 'none'
    }
  }

  setupSlots() {
    const { gameType, slots: lobbySlots } = this.lobbyConfig

    for (let i = 0; i < bw.slots.length; i++) {
      const slot = bw.slots[i]
      slot.playerId = i
      slot.stormId = 0xFF
      slot.type = i >= lobbySlots.length ? 'none' : 'open'
      slot.race = 'random'
      slot.team = 0
    }

    for (let i = 0; i < lobbySlots.length; i++) {
      const lobbySlot = lobbySlots[i]
      if (lobbySlot.type === 'observer') {
        continue
      }
      const slot = isUms(gameType) ? bw.slots[lobbySlot.playerId] : bw.slots[i]

      slot.playerId = isUms(gameType) ? lobbySlot.playerId : i
      slot.stormId = lobbySlot.type === 'human' ? 27 : 0xFF
      slot.race = getBwRace(lobbySlot.race)
      // This typeId check is completely ridiculous and doesn't make sense, but that gives
      // the same behaviour as normal bw. Not that any maps use those slot types as Scmdraft
      // doesn't allow setting them anyways D:
      if (!isUms(gameType) || (lobbySlot.typeId !== 1 && lobbySlot.typeId !== 2)) {
        slot.team = lobbySlot.teamId
      }
      slot.name = lobbySlot.name
      if (isUms(gameType) && lobbySlot.type !== 'human') {
        // The type of UMS computers is set in the map file, and we have no reason to
        // worry about the various possibilities there are, so just pass the integer onwards.
        slot.typeId = lobbySlot.typeId
      } else {
        slot.type = this.mapSlotTypes(lobbySlot.type)
      }
    }
  }

  updateSlots() {
    const stormNames = bw.getStormPlayerNames()
    const playerSlots = bw.slots.filter(s => s.type === 'human').reduce((r, s) => {
      r[s.name] = s
      return r
    }, {})
    const observers = this.lobbyConfig.slots
      .filter(s => s.type === 'observer')
      .map(s => s.name)

    for (let stormId = 0; stormId < stormNames.length; stormId++) {
      const name = stormNames[stormId]
      if (!name) continue

      if (observers.includes(name)) {
        log.verbose(`Observer ${name} received storm ID ${stormId}`)
      } else {
        const slot = playerSlots[name]
        if (!slot) {
          throw new Error(`Unexpected player name: ${stormNames[stormId]}`)
        }
        if (slot.stormId < 8 && slot.stormId !== stormId) {
          throw new Error(`Unexpected stormId change for ${name}`)
        }

        slot.stormId = stormId
        log.verbose(`Player ${name} received storm ID ${stormId}`)
      }
    }
  }
}

export default function initGame(socket, setupData) {
  const initializer = new GameInitializer(socket, setupData)
  initializer.run().catch(err => {
    log.error('Game init failed: ' + err.message)
    initializer.notifyProgress(GAME_STATUS_ERROR, { err: err.message })
  })
  return initializer
}
