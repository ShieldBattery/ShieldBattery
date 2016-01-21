import psi from './natives/index'

export function register(nydus, localSettings, activeGameManager) {
  async function setSettings(data, next) {
    // Will cause a publish via the settings change handler below
    localSettings.settings = data.get('body').settings
  }

  async function setGameConfig(data, next) {
    const config = data.get('body').gameConfig
    activeGameManager.setGameConfig(config)
  }

  nydus.registerRoute('/site/getResolution', detectResolution)
  nydus.registerRoute('/site/settings/set', setSettings)
  nydus.registerRoute('/site/setGameConfig', setGameConfig)

  localSettings.on('change', () => nydus.publish('/settings', localSettings.settings))
}

export function subscribe(nydus, client, activeGameManager, localSettings) {
  nydus.subscribeClient(client, '/game/status', activeGameManager.getStatus())
  nydus.subscribeClient(client, '/game/results')
  nydus.subscribeClient(client, '/settings', localSettings.settings)
}

async function detectResolution(data, next) {
  return await psi.detectResolution()
}
