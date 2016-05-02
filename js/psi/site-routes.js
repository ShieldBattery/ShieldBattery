import fs from 'fs'
import path from 'path'
import thenify from 'thenify'
import { detectResolution } from './natives/index'
import log from './logger'
import packageJson from '../package.json'

let lastHadValidPath = false

const accessAsync = thenify(fs.access)
async function hasValidPath(settings) {
  if (!settings.starcraftPath) {
    lastHadValidPath = false
  } else {
    try {
      await accessAsync(path.join(settings.starcraftPath, 'starcraft.exe'))
      lastHadValidPath = true
    } catch (e) {
      lastHadValidPath = false
    }
  }

  return lastHadValidPath
}


export function register(nydus, localSettings, activeGameManager, mapStore) {
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

  async function activateMap(data, next) {
    const { origin } = data.get('client').conn.request.headers
    const { hash, format } = data.get('body')
    return mapStore.downloadMap(origin, hash, format)
  }

  async function getVersion(data, next) {
    return packageJson.version
  }

  nydus.registerRoute('/site/getResolution', getResolution)
  nydus.registerRoute('/site/settings/set', setSettings)
  nydus.registerRoute('/site/setGameConfig', setGameConfig)
  nydus.registerRoute('/site/activateMap', activateMap)
  nydus.registerRoute('/site/getVersion', getVersion)

  localSettings.on('change', async function() {
    const validPath = await hasValidPath(localSettings.settings)
    nydus.publish('/settings', localSettings.settings)
    nydus.publish('/starcraftPathValidity', validPath)
  })
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  nydus.subscribeClient(client, '/game/status', activeGameManager.getStatusForSite())
  nydus.subscribeClient(client, '/game/results')
  nydus.subscribeClient(client, '/settings', localSettings.settings)
  nydus.subscribeClient(client, '/starcraftPathValidity', lastHadValidPath)
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
