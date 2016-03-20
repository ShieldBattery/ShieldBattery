import Immutable from 'immutable'
import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import { setSettings as setSnpSettings, setMappings } from './natives/snp'
import { melee } from './game-types'
import timeoutPromise from './timeout-promise'
import {
  GAME_STATUS_AWAITING_PLAYERS,
  GAME_STATUS_STARTING,
} from '../common/game-status'

forge.on('startWndProc', () => log.verbose('forge\'s wndproc pump started'))
  .on('endWndProc', () => log.verbose('forge\'s wndproc pump finished'))

function buildMappings(lobby, setup) {
  // Build an object mapping Fake-IP => { address, port }, ordered consistently between all
  // players (host first, then all other players ordered by slot). Computers are not included, as
  // we [obviously] won't be sending network traffic to them. This mapping will be used by our
  // SNP to shuttle packets back and forth from Storm while:
  // - Keeping consistent IPs/ports between all players of the game (even though they might differ
  //   due to NAT, LAN, etc.)
  // - Supporting protocols Storm doesn't properly support (i.e. IPv6)

  const players = Immutable.fromJS(lobby.players).valueSeq().filterNot(p => p.get('isComputer'))
  const hostId = lobby.hostId
  const ordered = players.filter(p => p.get('id') === hostId).concat(
      players.filterNot(p => p.get('id') === hostId).sortBy(p => p.get('slot')))
  const netInfos = ordered.map(p => {
    const netInfo = setup.networkInfo[p.get('id')]
    // TODO(tec27): The address really would have been whittled down to one by this point (and not
    // be an array)
    return { address: netInfo.addresses[0], port: netInfo.port }
  })
  return netInfos.toKeyedSeq().mapKeys(i => `10.27.27.${i}`).toJS()
}

function getBwRace(lobbyRace) {
  switch (lobbyRace) {
    case 'z': return 'zerg'
    case 't': return 'terran'
    case 'p': return 'protoss'
    default: return 'random'
  }
}

function setupSlots(lobbyConfig) {
  for (let i = 0; i < bw.slots.length; i++) {
    const slot = bw.slots[i]
    slot.playerId = i
    slot.stormId = 255
    slot.type = 'open'
    slot.race = 'random'
    slot.team = '0'
  }

  for (const id of Object.keys(lobbyConfig.players)) {
    const player = lobbyConfig.players[id]
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

  // TODO(tec27): set storm ID of our own slot
}

function updateSlots() {
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

async function waitForPlayers(socket, lobbyConfig) {
  const players = Immutable.fromJS(lobbyConfig.players).valueSeq()
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
      notifyProgress(socket, GAME_STATUS_AWAITING_PLAYERS, waitingArray)
      log.debug(`Waiting for players: ${waitingArray.join(', ')}`)
    }
  }

  return new Promise(resolve => {
    updateSlots()
    if (hasAllPlayers()) {
      resolve()
      return
    }

    const onPlayerJoin = () => {
      updateSlots()
      if (hasAllPlayers()) {
        bw.removeListener('netPlayerJoin', onPlayerJoin)
        resolve()
      }
    }
    bw.on('netPlayerJoin', onPlayerJoin)
  })
}

const CREATION_TIMEOUT = 10000
async function createLobby(lobby, localMap, localUser) {
  const params = {
    mapPath: localMap,
    gameType: melee(),
  }
  await timeoutPromise(CREATION_TIMEOUT, bw.createLobby(params), 'Creating lobby timed out')
}

const JOIN_TIMEOUT = 10000
async function joinLobby(lobby, localMap, localUser) {
  let succeeded = false
  while (!succeeded) {
    try {
      await timeoutPromise(JOIN_TIMEOUT,
          bw.joinLobby(localMap, '10.27.27.0', 6112), 'Joining lobby timed out')
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

function notifyProgress(socket, state, extra = null) {
  socket.invoke('/game/setupProgress', { status: { state, extra } })
}

export default async function initGame(socket, { lobby, settings, setup, localUser, localMap }) {
  // TODO(tec27): handle global settings?
  setSnpSettings(settings.local)
  bw.setSettings(settings.local)

  const mappings = buildMappings(lobby, setup)
  log.verbose('generated network mappings: ' + JSON.stringify(mappings))
  setMappings(mappings)

  if (!forge.inject()) {
    throw new Error('forge injection failed')
  }
  log.verbose('forge injected')

  await bw.initProcess()
  log.verbose('process initialized')
  forge.runWndProc()

  const myName = localUser.name

  bw.setName(myName)
  bw.initNetwork()

  const isHost = lobby.players[lobby.hostId].name === myName
  log.verbose('creating lobby for map: ' + localMap)
  if (isHost) {
    await createLobby(lobby, localMap, localUser)
  } else {
    // Give the host a bit more time to create, in the hopes that we hit a join on the first request
    // TODO(tec27): we could probably let the host have the config a bit earlier (and start creating
    // the game then) to better facilitate this
    await new Promise(resolve => setTimeout(resolve, 150))
    await joinLobby(lobby, localMap, localUser)
  }

  notifyProgress(socket, GAME_STATUS_AWAITING_PLAYERS)
  log.verbose('in lobby, setting up slots')

  const tickleInterval = setInterval(() => bw.tickleLobbyNetwork(), 100)
  try {
    setupSlots(lobby)
    await waitForPlayers(socket, lobby)
  } finally {
    clearInterval(tickleInterval)
  }

  notifyProgress(socket, GAME_STATUS_STARTING)
  log.verbose('setting game seed')
  // TODO(tec27): deal with player bytes if we ever allow save games
  bw.doLobbyGameInit(setup.seed | 0, [ 8, 8, 8, 8, 8, 8, 8, 8 ])
  forge.endWndProc()

  socket.invoke('/game/start')
  const { results, time } = await bw.runGameLoop()
  log.verbose('gameResults: ' + JSON.stringify(results))
  log.verbose('gameTime: ' + time)
  await socket.invoke('/game/end', { results, time })

  bw.cleanUpForExit(() => setTimeout(() => process.exit(), 100))
}
