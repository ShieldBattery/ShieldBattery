export function register(nydus, activeGameManager) {
  nydus
    .registerRoute('/game/setupProgress', getGameId, onSetupProgress)
    .registerRoute('/game/start', getGameId, onStart)
    .registerRoute('/game/end', getGameId, onEnd)

  async function getGameId(data, next) {
    const id = data.get('client').conn.request.headers['x-game-id']
    const newData = data.set('gameId', id)
    await next(newData)
  }

  async function onSetupProgress(data, next) {
    activeGameManager.handleSetupProgress(data.get('gameId'), data.get('body').status)
  }

  async function onStart(data, next) {
    activeGameManager.handleGameStart(data.get('gameId'))
  }

  async function onEnd(data, next) {
    const body = data.get('body')
    activeGameManager.handleGameEnd(data.get('gameId'), body.results, body.time)
  }
}
