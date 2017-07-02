let activeGameManager
if (IS_ELECTRON) {
  const ActiveGameManager = require('./active-game-manager').default
  const mapStore = require('../maps/map-store-instance').default

  activeGameManager = new ActiveGameManager(mapStore)
}

export default activeGameManager
