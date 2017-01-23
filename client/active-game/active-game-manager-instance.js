function makeActiveGameManager() {
  if (process.webpackEnv.SB_ENV !== 'electron') {
    return null
  }

  const ActiveGameManager = require('./active-game-manager').default
  const mapStore = require('../maps/map-store-instance').default

  return new ActiveGameManager(mapStore)
}

export default makeActiveGameManager()
