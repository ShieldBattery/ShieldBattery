import psi from './natives/index'

export function register(nydus, localSettings, activeGameManager) {
  async function setSettings(data, next) {
    // TODO(tec27): implement
    nydus.publish('/settings', localSettings.getSettings())
  }

  async function setGameConfig(data, next) {
    // TODO
    activeGameManager.setGameConfig(/* ... */)
  }

  nydus.registerRoute('/site/getResolution', detectResolution)
  nydus.registerRoute('/site/settings/set', setSettings)
  nydus.registerRoute('/site/setGameConfig', setGameConfig)
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  nydus.subscribeClient(client, '/game/status', activeGameManager.getStatus())
  nydus.subscribeClient(client, '/game/results')
  nydus.subscribeClient(client, '/settings', localSettings.getSettings())
}

async function detectResolution(data, next) {
  return await psi.detectResolution()
}
