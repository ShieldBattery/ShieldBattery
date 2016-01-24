import Immutable from 'immutable'
import log from './logger'
import bw from './natives/bw'
import forge from './natives/forge'
import { setSettings as setSnpSettings, setMappings } from './natives/snp'

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
}
