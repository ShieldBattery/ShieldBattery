export function register(nydus, activeGameManager) {
  nydus
    .registerRoute('/game/setupProgress', getGameId, onSetupProgress)
    .registerRoute('/game/ready', getGameId, onReady)
    .registerRoute('/game/end', getGameId, onEnd)

  async function getGameId(data, next) {
    const id = data.get('client').conn.request.headers['x-game-id']
    const newData = data.set('gameId', id)
    await next(newData)
  }

  async function onSetupProgress(data, next) {
    if (activeGameManager.id !== data.get('gameId')) return
    // TODO(tec27): implement
  }

  async function onReady(data, next) {
    if (activeGameManager.id !== data.get('gameId')) return
    // TODO(tec27): implement
  }

  async function onEnd(data, next) {
    if (activeGameManager.id !== data.get('gameId')) return
    // TODO(tec27): implement
  }
}
