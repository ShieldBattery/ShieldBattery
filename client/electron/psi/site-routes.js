import log from './logger'

export function register(nydus, activeGameManager, mapStore, rallyPointManager) {
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

  nydus.registerRoute('/site/setGameConfig', setGameConfig)
  nydus.registerRoute('/site/setGameRoutes', setGameRoutes)
  nydus.registerRoute('/site/activateMap', activateMap)
  nydus.registerRoute('/site/rallyPoint/setServers', setRallyPointServers)
  nydus.registerRoute('/site/rallyPoint/refreshPings', refreshRallyPointPings)

  rallyPointManager.on('ping', (origin, serverIndex, desc, ping) => {
    log.verbose(
        `Got rally-point ping for origin ${origin}, server #${serverIndex} [${desc}]: ${ping}`)
    nydus.publish(`/rallyPoint/ping/${encodeURIComponent(origin)}`, { serverIndex, ping })
  })
}

export function subscribe(nydus, client, activeGameManager) {
  const { origin } = client.conn.request.headers

  const statuses = activeGameManager.getInitialStatus(origin)
  nydus.subscribeClient(client, `/game/status/${encodeURIComponent(origin)}`, statuses)
  nydus.subscribeClient(client, `/game/results/${encodeURIComponent(origin)}`)
  nydus.subscribeClient(client, `/game/replaySave/${encodeURIComponent(origin)}`)
  nydus.subscribeClient(client, `/rallyPoint/ping/${encodeURIComponent(origin)}`)
}
