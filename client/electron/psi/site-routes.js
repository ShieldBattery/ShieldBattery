import path from 'path'
import errors from 'http-errors'
import { detectResolution, readFolder } from './natives'
import getReplayFolder from './get-replay-folder'
import log from './logger'
import packageJson from '../../../package.json'
import PathValidator from './path-validator'

let pathValidator

export function register(nydus, localSettings, activeGameManager, mapStore, rallyPointManager) {
  pathValidator = new PathValidator(({ path: pathValid, version }) => {
    nydus.publish('/starcraftPathValidity', pathValid)
    nydus.publish('/starcraftCorrectVersion', version)
  })

  async function setSettings(data, next) {
    // Will cause a publish via the settings change handler below
    localSettings.settings = data.get('body').settings
  }

  async function setGameConfig(data, next) {
    const { origin } = data.get('client').conn.request.headers
    const config = data.get('body')
    const user = [config.localUser.name, origin]
    return activeGameManager.setGameConfig(user, config)
  }

  async function setGameRoutes(data, next) {
    const { gameId, routes } = data.get('body')
    activeGameManager.setGameRoutes(gameId, routes)
  }

  async function activateMap(data, next) {
    const { hash, format } = data.get('body')
    return mapStore.downloadMap(hash, format)
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
  nydus.registerRoute('/site/getReplays', getReplays)
  nydus.registerRoute('/site/rallyPoint/setServers', setRallyPointServers)
  nydus.registerRoute('/site/rallyPoint/refreshPings', refreshRallyPointPings)

  localSettings.on('change', async function() {
    nydus.publish('/settings', localSettings.settings)
    pathValidator.getPathValidity(localSettings.settings)
  })

  rallyPointManager.on('ping', (origin, serverIndex, desc, ping) => {
    log.verbose(
        `Got rally-point ping for origin ${origin}, server #${serverIndex} [${desc}]: ${ping}`)
    nydus.publish(`/rallyPoint/ping/${encodeURIComponent(origin)}`, { serverIndex, ping })
  })
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  const { origin } = client.conn.request.headers

  let pathValid = false
  let versionValid = false
  if (localSettings.settings) {
    const { path: newPathValid, version: newVersionValid } =
        pathValidator.getPathValidity(localSettings.settings)
    pathValid = newPathValid
    versionValid = newVersionValid
  }

  const statuses = activeGameManager.getInitialStatus(origin)
  nydus.subscribeClient(client, `/game/status/${encodeURIComponent(origin)}`, statuses)
  nydus.subscribeClient(client, `/game/results/${encodeURIComponent(origin)}`)
  nydus.subscribeClient(client, `/game/replaySave/${encodeURIComponent(origin)}`)
  nydus.subscribeClient(client, '/settings', localSettings.settings)
  nydus.subscribeClient(client, '/starcraftPathValidity', pathValid)
  nydus.subscribeClient(client, '/starcraftCorrectVersion', versionValid)
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

async function getReplays(data, next) {
  const { path: relativePath } = data.get('body')
  if (path.isAbsolute(relativePath)) {
    throw new errors.BadRequest('path can\'t be absolute')
  }

  const normalized = path.normalize(relativePath)
  if (normalized === '..' || normalized.startsWith('../') || normalized.startsWith('..\\')) {
    throw new errors.BadRequest('path can\'t be outside the replays folder')
  }

  try {
    const replaysFolderPath = getReplayFolder()
    const entries = await readFolder(path.join(replaysFolderPath, normalized))
    return (entries
      .filter(f => f.isFolder || f.name.endsWith('.rep'))
      .map(f => {
        f.path = path.relative(replaysFolderPath, f.path)
        if (!f.isFolder) {
          f.name = f.name.slice(0, -4)
        }
        // TODO(tec27): once we're not doing this over a socket, we can probably leave this as a
        // date
        f.date = +f.date
        return f
      }))
  } catch (err) {
    log.error('Error getting the replays: ' + err)
    throw err
  }
}
