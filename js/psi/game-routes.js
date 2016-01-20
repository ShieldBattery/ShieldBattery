export function register(nydus, activeGameManager) {
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

  nydus.registerRoute('/game/setupProgress', getGameId, onSetupProgress)
  nydus.registerRoute('/game/start', getGameId, onStart)
  nydus.registerRoute('/game/end', getGameId, onEnd)
}
