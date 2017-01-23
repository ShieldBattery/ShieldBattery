export function register(nydus, activeGameManager, mapStore) {
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

  nydus.registerRoute('/site/setGameConfig', setGameConfig)
  nydus.registerRoute('/site/setGameRoutes', setGameRoutes)
  nydus.registerRoute('/site/activateMap', activateMap)
}

export function subscribe(nydus, client, activeGameManager) {
  const { origin } = client.conn.request.headers

  const statuses = activeGameManager.getInitialStatus(origin)
  nydus.subscribeClient(client, `/game/status/${encodeURIComponent(origin)}`, statuses)
  nydus.subscribeClient(client, `/game/results/${encodeURIComponent(origin)}`)
  nydus.subscribeClient(client, `/game/replaySave/${encodeURIComponent(origin)}`)
}
