import path from 'path'
import { detectResolution, checkStarcraftPath } from './natives/index'
import log from './logger'
import packageJson from '../package.json'

let lastHadValidPath = false
let lastHadValidVersion = false
async function hasValidPath(settings) {
  if (!settings.starcraftPath) {
    lastHadValidPath = false
    lastHadValidVersion = false
    log.debug('StarCraft path invalid because no path is set')
  } else {
    try {
      await checkStarcraftPath(path.join(settings.starcraftPath, 'starcraft.exe'))
      lastHadValidPath = true
      lastHadValidVersion = true
      log.debug('StarCraft path is valid')
    } catch (e) {
      if (e.name === 'ProductVersionError') {
        lastHadValidPath = true
        lastHadValidVersion = false
        log.debug('StarCraft path is valid, but the version is incorrect')
      } else {
        lastHadValidPath = false
        lastHadValidVersion = false
        log.debug('StarCraft path is invalid, error was: ' + e)
      }
    }
  }

  return { path: lastHadValidPath, version: lastHadValidVersion }
}


export function register(nydus, localSettings, activeGameManager, mapStore, rallyPointManager) {
  // init our cache
  hasValidPath(localSettings.settings)

  async function setSettings(data, next) {
    // Will cause a publish via the settings change handler below
    localSettings.settings = data.get('body').settings
  }

  async function setGameConfig(data, next) {
    const config = data.get('body')
    return activeGameManager.setGameConfig(config)
  }

  async function setGameRoutes(data, next) {
    const { gameId, routes } = data.get('body')
    activeGameManager.setGameRoutes(gameId, routes)
  }

  async function activateMap(data, next) {
    const { origin } = data.get('client').conn.request.headers
    const { hash, format } = data.get('body')
    return mapStore.downloadMap(origin, hash, format)
  }

  async function getVersion(data, next) {
    return packageJson.version
  }

  async function setRallyPointServers(data, next) {
    const { origin } = data.get('client').conn.request.headers
    const { servers } = data.get('body')

    log.verbose(`Got new rally-point servers for ${origin}: ${JSON.stringify(servers)}`)

    return rallyPointManager.setServers(origin, servers)
  }

  async function refreshRallyPointPings(data, next) {
    const { origin } = data.get('client').conn.request.headers
    rallyPointManager.refreshPingsForOrigin(origin)
  }

  nydus.registerRoute('/site/getResolution', getResolution)
  nydus.registerRoute('/site/settings/set', setSettings)
  nydus.registerRoute('/site/setGameConfig', setGameConfig)
  nydus.registerRoute('/site/setGameRoutes', setGameRoutes)
  nydus.registerRoute('/site/activateMap', activateMap)
  nydus.registerRoute('/site/getVersion', getVersion)
  nydus.registerRoute('/site/rallyPoint/setServers', setRallyPointServers)
  nydus.registerRoute('/site/rallyPoint/refreshPings', refreshRallyPointPings)

  localSettings.on('change', async function() {
    const { path, version } = await hasValidPath(localSettings.settings)
    nydus.publish('/settings', localSettings.settings)
    nydus.publish('/starcraftPathValidity', path)
    nydus.publish('/starcraftCorrectVersion', version)
  })

  rallyPointManager.on('ping', (origin, serverIndex, desc, ping) => {
    log.verbose(
        `Got rally-point ping for origin ${origin}, server #${serverIndex} [${desc}]: ${ping}`)
    nydus.publish(`/rallyPoint/ping/${encodeURIComponent(origin)}`, { serverIndex, ping })
  })
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  const { origin } = client.conn.request.headers

  nydus.subscribeClient(client, '/game/status', activeGameManager.getStatusForSite())
  nydus.subscribeClient(client, '/game/results')
  nydus.subscribeClient(client, '/settings', localSettings.settings)
  nydus.subscribeClient(client, '/starcraftPathValidity', lastHadValidPath)
  nydus.subscribeClient(client, '/starcraftCorrectVersion', lastHadValidVersion)
  nydus.subscribeClient(client, `/rallyPoint/ping/${encodeURIComponent(origin)}`)
}

async function getResolution(data, next) {
  log.verbose('Detecting resolution')
  try {
    const res = await detectResolution()
    log.verbose(`Got resolution ${JSON.stringify(res)}`)
    return res
  } catch (err) {
    log.error('Error detecting resolution: ' + err)
    throw err
  }
}
