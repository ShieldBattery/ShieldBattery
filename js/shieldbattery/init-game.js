import Immutable from 'immutable'
import RallyPoint from 'rally-point-player'
import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import { setRallyPoint, setNetworkRoutes } from './natives/snp'
import { melee } from './game-types'
import createDeferred from '../common/async/deferred'
import rejectOnTimeout from './reject-on-timeout'
import {
  GAME_STATUS_AWAITING_PLAYERS,
  GAME_STATUS_STARTING,
} from '../common/game-status'

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
    const players =
        Immutable.fromJS(this.lobbyConfig.players).valueSeq().filterNot(p => p.get('isComputer'))
    const hostId = this.lobbyConfig.hostId
    const ordered = players.filter(p => p.get('id') === hostId).concat(
        players.filterNot(p => p.get('id') === hostId).sortBy(p => p.get('slot')))
    const routesById = new Map(rallyPointRoutes.map(r => [ r.forId, r.route ]))
    const netInfos = ordered.map(p => routesById.get(p.get('id')))
    return netInfos.toKeyedSeq().mapKeys(i => `10.27.27.${i}`).toJS()
  }

  async joinRoutes() {
    const rallyPoint = this.rallyPoint
    // For each route, ping the IPv4 and IPv6 endpoints. Whichever ping comes back first, send the
    // join request to that address. (We expect both to take about the same amount of time, but this
    // will remove any addresses we can't talk to, e.g. IPv6 when we only have an IPv4 address).
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
      log.verbose(
          `Connected to ${chosenAddress}:${port} for player ${route.for} [${route.routeId}]`)
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

    const isHost = this.lobbyConfig.players[this.lobbyConfig.hostId].name === myName
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
    // TODO(tec27): deal with player bytes if we ever allow save games
    bw.doLobbyGameInit(this.setup.seed | 0, [ 8, 8, 8, 8, 8, 8, 8, 8 ])
    forge.endWndProc()

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
    const params = {
      mapPath: this.localMap,
      gameType: melee(),
    }
    await rejectOnTimeout(bw.createLobby(params), CREATION_TIMEOUT, 'Creating lobby timed out')
  }

  async joinLobby() {
    let succeeded = false
    while (!succeeded) {
      try {
        await rejectOnTimeout(bw.joinLobby(this.localMap, '10.27.27.0', 6112),
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
    const players = Immutable.fromJS(this.lobbyConfig.players).valueSeq()
      .filterNot(p => p.get('isComputer'))
      .map(p => p.get('name'))
      .toList()

    const hasAllPlayers = () => {
      const playerSlots = bw.slots.filter(s => s.type === 'human')
      const waitingFor = players.filter(p => !playerSlots.find(s => s.name === p && s.stormId < 8))
      if (!waitingFor.size) {
        return true
      } else {
        const waitingArray = waitingFor.toArray()
        this.notifyProgress(GAME_STATUS_AWAITING_PLAYERS, waitingArray)
        log.debug(`Waiting for players: ${waitingArray.join(', ')}`)
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

  setupSlots() {
    for (let i = 0; i < bw.slots.length; i++) {
      const slot = bw.slots[i]
      slot.playerId = i
      slot.stormId = 255
      slot.type = 'open'
      slot.race = 'random'
      slot.team = '0'
    }

    for (const id of Object.keys(this.lobbyConfig.players)) {
      const player = this.lobbyConfig.players[id]
      const slot = bw.slots[player.slot]

      if (!player.isComputer) {
        slot.name = player.name
        slot.type = 'human'
        slot.stormId = 27 // signals that they're not here yet, will fill in when connected
      } else {
        // for humans, stormId will be set when Storm tells us they've connected
        slot.stormId = 0xFF
        slot.type = 'lobbycomputer'
      }

      slot.playerId = player.slot
      slot.race = getBwRace(player.race)
      // TODO(tec27): teams? nations?
    }
  }

  updateSlots() {
    const stormNames = bw.getStormPlayerNames()
    const playerSlots = bw.slots.filter(s => s.type === 'human').reduce((r, s) => {
      r[s.name] = s
      return r
    }, {})

    for (let stormId = 0; stormId < stormNames.length; stormId++) {
      if (!stormNames[stormId]) continue

      const slot = playerSlots[stormNames[stormId]]
      if (!slot) {
        throw new Error(`Unexpected player name: ${stormNames[stormId]}`)
      }
      if (slot.stormId < 8 && slot.stormId !== stormId) {
        throw new Error(`Unexpected stormId change for ${slot.name}`)
      }

      slot.stormId = stormId
      log.verbose(`Player ${slot.name} received storm ID ${stormId}`)
    }
  }
}

export default function initGame(socket, setupData) {
  const initializer = new GameInitializer(socket, setupData)
  initializer.run()
  return initializer
}
