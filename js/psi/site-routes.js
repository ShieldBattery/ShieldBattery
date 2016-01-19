import psi from './natives/index'

export function register(nydus, localSettings, activeGameManager) {
  nydus
    .registerRoute('/site/getResolution', detectResolution)
    .registerRoute('/site/settings/set', setSettings)
    .registerRoute('/site/setGameConfig', setGameConfig)

  async function setSettings(data, next) {
    // TODO(tec27): implement
    nydus.publish('/settings', localSettings.getSettings())
  }

  async function setGameConfig(data, next) {
    // TODO
    activeGameManager.setGameConfig(/* ... */)
  }
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  nydus.subscribeClient(client, '/game/status', activeGameManager.getStatus())
    .subscribeClient(client, '/game/results')
    .subscribeClient(client, '/settings', localSettings.getSettings())
}

async function detectResolution(data, next) {
  return await psi.detectResolution()
}
