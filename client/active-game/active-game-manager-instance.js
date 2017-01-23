let activeGameManager
if (process.webpackEnv.SB_ENV === 'electron') {
  const ActiveGameManager = require('./active-game-manager').default
  const mapStore = require('../maps/map-store-instance').default

  activeGameManager = new ActiveGameManager(mapStore)
}

export default activeGameManager
