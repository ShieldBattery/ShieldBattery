import Immutable from 'immutable'
import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import { setSettings as setSnpSettings, setMappings } from './natives/snp'
import { melee } from './game-types'
import timeoutPromise from './timeout-promise'

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

const CREATION_TIMEOUT = 10000
const ADD_COMPUTER_TIMEOUT = 3000
async function createLobby(lobby, localUser) {
  const params = {
    mapPath: lobby.map,
    gameType: melee(),
  }
  const bwLobby = await timeoutPromise(CREATION_TIMEOUT, bw.createLobby(localUser.name, params),
      'Creating lobby timed out')
  const computers = Immutable.fromJS(lobby.players)
    .valueSeq()
    .filter(p => p.get('isComputer'))
    .toList()
  if (computers.size) {
    let c = computers.size
    while (c > 0) {
      // TODO(tec27): our lobby impl should real deal with the command queue for us
      let foundSlot = false
      for (let i = 0; i < bwLobby.slots.length && !foundSlot; i++) {
        if (bwLobby.slots[i].type === 'open') {
          await timeoutPromise(
              ADD_COMPUTER_TIMEOUT, bwLobby.addComputer(i), 'Adding computer timed out')
          c--
          foundSlot = true
          break
        }
      }
      if (!foundSlot) break
    }

    if (c > 0) {
      throw new Error('Not enough empty slots for computers')
    }
  }

  // TODO(tec27): wait until all players are connected
  await bwLobby.startGame()

  return bwLobby
}

async function joinLobby(localUser) {
  throw new Error('Not yet implemented')
}

export default async function initGame({ lobby, settings, setup, localUser }) {
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
  const isHost = lobby.players[lobby.hostId].name === myName
  const bwLobby = isHost ? await createLobby(lobby, localUser) : await joinLobby(localUser)

  forge.endWndProc()
  const { results, time } = await bwLobby.runGameLoop()
  log.verbose('gameResults: ' + JSON.stringify(results))
  log.verbose('gameTime: ' + time)
  // TODO(tec27): report these?
  bw.cleanUpForExit(() => setTimeout(() => process.exit(), 100))
}
