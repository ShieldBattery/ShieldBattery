import { List } from 'immutable'
import RallyPoint from 'rally-point-player'
import { setRallyPoint, setNetworkRoutes } from './natives/snp'
import * as gameTypes from './game-types'
import { isUms } from '../../app/common/lobbies'
import createDeferred from '../../app/common/async/deferred'
import CancelToken from '../../app/common/async/cancel-token'
import log from './logger'

import bw from './natives/bw'
import forge from './natives/forge'

class RouteManager {
  constructor(rallyPoint, boundPromise, routes) {
    this.rallyPoint = rallyPoint
    this.boundPromise = boundPromise
    this.routes = routes
    this.cancelToken = new CancelToken()
    this.keepAlive = true

    this._serverPings = new Map()
  }

  async joinAll() {
    await this.boundPromise

    // For each route, ping the IPv4 and IPv6 endpoints. Whichever ping comes back first, send the
    // join request to that address. (We expect both to take about the same amount of time, but this
    // will remove any addresses we can't talk to, e.g. IPv6 when we only have an IPv4 address)
    const joinPromises = this.routes.map(async route => {
      this.cancelToken.throwIfCancelling()

      const server = await this._pickServer(route.server)
      this.cancelToken.throwIfCancelling()
      const joined = await this.rallyPoint.joinRoute(
        { address: server.address, port: server.port }, route.routeId, route.playerId)
      log.verbose(
        `Connected to ${route.server.desc} for id ${route.for} [${route.routeId}]`)
      return { route: joined, forId: route.for }
    })

    const readyPromises = joinPromises.map(async joinPromise => {
      this.cancelToken.throwIfCancelling()

      const { route, forId } = await joinPromise
      await route.untilReady()
      log.verbose(`Route [${route.routeId}] is ready`)
      return { route, forId }
    })

    // Keep routes alive until someone else takes them over from us (or the process is cancelled)
    joinPromises.map(async joinPromise => {
      this.cancelToken.throwIfCancelling()

      const route = await joinPromise
      await new Promise(resolve => setTimeout(resolve, 500))

      while (this.keepAlive) {
        this.cancelToken.throwIfCancelling()
        route.keepAlive()
        await new Promise(resolve => setTimeout(resolve, 500))
      }
    }).map(promise => promise.catch(err => {
      if (err.name !== CancelToken.ERROR_NAME) {
        log.error('Unhandled error while waiting for join promises: ' + err)
      }
    }))

    return Promise.all(readyPromises)
  }

  // Cancel any joining/waiting process, because the routes have been superceded by newer ones (or
  // the game launch process has been cancelled entirely)
  cancel() {
    if (this.keepAlive) {
      this.cancelToken.cancel()
    }
  }

  // Release these routes, allowing them to be managed by some other owner (for instance, if
  // the game launch is actually occurring and the SNP code will handle them)
  release() {
    this.keepAlive = false
  }

  _pickServer(server) {
    const serverKey = `${server.port}|${server.address6}`
    if (this._serverPings.has(serverKey)) {
      return this._serverPings.get(serverKey)
    }

    const promise = this._pingServer(server)
    this._serverPings.set(serverKey, promise)
    return promise
  }

  async _pingServer(server) {
    const { port, address4, address6 } = server
    for (let i = 0; i < 3; i++) {
      this.cancelToken.throwIfCancelling()

      const pingPromises = []
      if (address4) {
        pingPromises.push(this.rallyPoint.pingServers([{ address: address4, port }]))
      }
      if (address6) {
        pingPromises.push(this.rallyPoint.pingServers([{ address: address6, port }]))
      }
      const [ pingResult ] = await Promise.race(pingPromises)

      if (pingResult.time < Number.MAX_VALUE) {
        return { address: pingResult.server.address, port }
      }
    }

    throw new Error(`Could not reach rally-point server: ${JSON.stringify(server)}`)
  }
}

function buildNetworkMappings(routes, slots, host) {
  // Build an object mapping Fake-IP => rally-point route, ordered consistently between all
  // players (host first, then all other players ordered by slot). Computers are not included, as
  // we [obviously] won't be sending network traffic to them. This mapping will be used by our
  // SNP to shuttle packets back and forth from Storm while:
  // - Keeping consistent IPs/ports between all players of the game (even though they might differ
  //   due to NAT, LAN, etc.)
  // - Allowing us to easily get references to active rally-point routes
  const slotList = new List(slots)
  const players = slotList.filter(slot => slot.type === 'human' || slot.type === 'observer')
  const ordered = players.filter(p => p.id === host.id)
    .concat(players.filterNot(p => p.id === host.id))
  const routesById = new Map(routes.map(r => [ r.forId, r.route ]))
  const netInfos = ordered.map(p => routesById.get(p.id))
  return netInfos.toKeyedSeq().mapKeys(i => `10.27.27.${i}`).toJS()
}

async function createLobby(gameType, gameSubType, mapPath) {
  const params = {
    mapPath,
    gameType: gameTypes[gameType](gameSubType),
  }
  await bw.createLobby(params)
}

async function joinLobby(gameType, gameSubType, gameName, slots, map, mapPath, cancelToken) {
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

  const gameTypeValue = gameTypes[gameType](gameSubType)
  const bwGameInfo = {
    gameName,
    numSlots: slots.length,
    numPlayers: slots
      .filter(slot => slot.type === 'human' || slot.type === 'observer').length,
    mapName: map.name,
    mapTileset: tilesetNameToId[map.tileset],
    mapWidth: map.width,
    mapHeight: map.height,
    gameType: gameTypeValue & 0xFFFF,
    gameSubtype: (gameTypeValue >> 16) & 0xFFFF,
  }

  while (!succeeded) {
    cancelToken.throwIfCancelling()
    try {
      await bw.joinLobby(mapPath, '10.27.27.0', 6112, bwGameInfo)
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

function getBwRace(configRace) {
  switch (configRace) {
    case 'z': return 'zerg'
    case 't': return 'terran'
    case 'p': return 'protoss'
    default: return 'random'
  }
}

// Maps the config slot type to a BW slot type
function mapSlotTypes(type) {
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

function setupSlots(configSlots, gameType) {
  for (let i = 0; i < bw.slots.length; i++) {
    const slot = bw.slots[i]
    slot.playerId = i
    slot.stormId = 0xFF
    slot.type = i >= configSlots.length ? 'none' : 'open'
    slot.race = 'random'
    slot.team = 0
  }

  for (let i = 0; i < configSlots.length; i++) {
    const configSlot = configSlots[i]
    if (configSlot.type === 'observer') {
      continue
    }
    const slot = isUms(gameType) ? bw.slots[configSlot.playerId] : bw.slots[i]

    slot.playerId = isUms(gameType) ? configSlot.playerId : i
    slot.stormId = configSlot.type === 'human' ? 27 : 0xFF
    slot.race = getBwRace(configSlot.race)
    // This typeId check is completely ridiculous and doesn't make sense, but that gives
    // the same behaviour as normal bw. Not that any maps use those slot types as Scmdraft
    // doesn't allow setting them anyways D:
    if (!isUms(gameType) || (configSlot.typeId !== 1 && configSlot.typeId !== 2)) {
      slot.team = configSlot.teamId
    }
    slot.name = configSlot.name
    if (isUms(gameType) && configSlot.type !== 'human') {
      // The type of UMS computers is set in the map file, and we have no reason to
      // worry about the various possibilities there are, so just pass the integer onwards.
      slot.typeId = configSlot.typeId
    } else {
      slot.type = mapSlotTypes(configSlot.type)
    }
  }
}

async function waitForPlayers(slots) {
  const players = slots
    .filter(slot => slot.type === 'human')
    .map(p => p.name)
  const observers = slots
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
      log.debug(`Waiting for players: ${allWaiting.join(', ')}`)
      return false
    }
  }

  return new Promise(resolve => {
    updateSlots(slots)
    if (hasAllPlayers()) {
      resolve()
      return
    }

    const onPlayerJoin = () => {
      updateSlots(slots)
      if (hasAllPlayers()) {
        bw.removeListener('netPlayerJoin', onPlayerJoin)
        resolve()
      }
    }
    bw.on('netPlayerJoin', onPlayerJoin)
  })
}

function updateSlots(slots) {
  const stormNames = bw.getStormPlayerNames()
  const playerSlots = bw.slots.filter(s => s.type === 'human').reduce((r, s) => {
    r[s.name] = s
    return r
  }, {})
  const observers = slots
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

export default class GameInitializer {
  constructor(socket, cancelToken) {
    this.socket = socket
    this.cancelToken = cancelToken
    this.rallyPoint = new RallyPoint('::', 0)

    this.rallyPointBound = this.rallyPoint.bind()
    setRallyPoint(this.rallyPoint)

    this.running = false
    this.commandQueue = []
    this.commandQueuePromise = createDeferred()

    this.hasSetupGame = false
    this.settings = null
    this.localUser = null
    this.routeManager = null
    this.routesReady = null
  }

  async run() {
    if (this.running) {
      throw new Error('GameInitializer is already running')
    }

    this.running = true
    this.cancelToken.throwIfCancelling()

    setRallyPoint(this.rallyPoint)
    if (!forge.inject()) {
      throw new Error('forge injection failed')
    }
    log.verbose('forge injected')

    // Handle commands as they come in. Possible commands:
    // - No-op (just triggers us to check cancel token, resets timeout)
    // - Set rally-point routes
    // - Set settings
    // - Set local user
    // - Setup game (once this happens, trying to execute any of the above commands is an error)
    //
    // The 3 'set' actions *must* occur at least once before attempting to setup a game. We need to
    // wait for any outstanding async actions (like joining routes) to finish before setting up the
    // game completely, although some actions can be taken before they finish (like creating a
    // lobby, for example)
    //
    // If we don't receive a command after some sufficiently long period, we assume that the app has
    // forgotten about us and exit. This is mostly just a safeguard against leaving BW processses
    // running forever.
    try {
      while (true) {
        await this.commandQueuePromise
        this.cancelToken.throwIfCancelling()

        while (this.commandQueue.length > 0) {
          const command = this.commandQueue.shift()
          switch (command.type) {
            case 'noop': break
            case 'localUser': this._runSetLocalUser(command); break
            case 'settings': this._runSetSettings(command); break
            case 'routes': this._runSetRoutes(command); break
            case 'setupGame': await this._runSetupGame(command); break
            default: throw new Error('Unknown command type: ' + command.type)
          }
        }

        this.commandQueuePromise = createDeferred()
      }
    } finally {
      if (this.routeManager) {
        this.routeManager.cancel()
      }
    }
  }

  _execCommand(command) {
    this.commandQueue.push(command)
    this.commandQueuePromise.resolve()
  }

  noOp() {
    this._execCommand({ type: 'noop' })
  }

  setLocalUser(user) {
    this._execCommand({ type: 'localUser', user })
  }

  setSettings(settings) {
    this._execCommand({ type: 'settings', settings })
  }

  setRoutes(routes) {
    this._execCommand({ type: 'routes', routes })
  }

  doGameSetup(setup) {
    this._execCommand({ type: 'setupGame', setup })
  }

  _runSetLocalUser({ user }) {
    if (this.hasSetupGame) {
      throw new Error('Cannot set local user after game setup has occurred')
    }
    this.localUser = user
  }

  _runSetSettings({ settings }) {
    if (this.hasSetupGame) {
      throw new Error('Cannot set settings after game setup has occurred')
    }
    this.settings = settings
    // TODO(tec27): handle global settings?
    bw.setSettings(settings.local)
  }

  _runSetRoutes({ routes }) {
    if (this.hasSetupGame) {
      throw new Error('Cannot set routes after game setup has occurred')
    }
    if (this.routeManager) {
      this.routeManager.cancel()
    }

    this.routeManager = new RouteManager(this.rallyPoint, this.rallyPointBound, routes)
    this.routesReady = this.routeManager.joinAll()
  }

  async _runSetupGame({ setup: { name, map, mapPath, gameType, gameSubType, slots, host, seed } }) {
    if (!this.localUser) {
      throw new Error('Cannot setup game without local user')
    }
    if (!this.settings) {
      throw new Error('Cannot setup game without settings')
    }
    if (!this.routeManager) {
      throw new Error('Cannot setup game without routes')
    }

    this.hasSetupGame = true

    await bw.initProcess()
    log.verbose('process initialized')
    forge.runWndProc()

    const myName = this.localUser.name
    bw.setName(myName)

    await this.rallyPointBound
    bw.initNetwork()

    const isHost = host.name === myName
    if (isHost) {
      log.verbose('creating lobby for map: ' + mapPath)
      await createLobby(gameType, gameSubType, mapPath)
    }

    const routes = await this.routesReady
    const networkMappings = buildNetworkMappings(routes, slots, host)
    setNetworkRoutes(networkMappings)

    this.routeManager.release()

    if (!isHost) {
      // TODO(tec27): Notify players when lobby is ready (and have all joiners wait on that), so we
      // avoid BW's mandatory 5 second timeout on joining
      log.verbose('joining lobby with map: ' + mapPath)
      await joinLobby(gameType, gameSubType, name, slots, map, mapPath, this.cancelToken)
    }

    log.verbose('in lobby, setting up slots')
    const tickleInterval = setInterval(() => bw.tickleLobbyNetwork(), 100)
    try {
      setupSlots(slots, gameType)
      await waitForPlayers(slots)
    } finally {
      clearInterval(tickleInterval)
    }

    const stormNames = bw.getStormPlayerNames()
    const playerNameToStormId = name => {
      const idx = stormNames.findIndex(x => x === name)
      if (idx === -1) {
        throw new Error(`${name} does not have storm id`)
      }
      return idx
    }
    const stormPlayerIds = slots
      .filter(slot => slot.type === 'human' || slot.type === 'observer')
      .map(p => playerNameToStormId(p.name))
    // TODO(tec27): deal with player bytes if we ever allow save games
    log.verbose('setting game seed')
    bw.doLobbyGameInit(seed | 0, stormPlayerIds, [ 8, 8, 8, 8, 8, 8, 8, 8 ])
    forge.endWndProc()

    const mySlot = slots.find(x => x.name === myName)
    if (mySlot && mySlot.type === 'observer') {
      const observerStormIds = slots
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
}
