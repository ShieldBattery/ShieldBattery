import type { ActiveGameManager } from './active-game-manager'

let activeGameManager: ActiveGameManager | undefined
if (IS_ELECTRON) {
  const { ActiveGameManager } = require('./active-game-manager')
  const mapStore = require('../maps/map-store-instance').default

  activeGameManager = new ActiveGameManager(mapStore)
}

export default activeGameManager
