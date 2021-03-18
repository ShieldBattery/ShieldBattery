import { GameConfig, GameRoute } from '../../common/game-config'
import {
  ACTIVE_GAME_SET_CONFIG,
  ACTIVE_GAME_SET_ROUTES,
  ACTIVE_GAME_START_WHEN_READY,
} from '../../common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : undefined

export function setGameConfig(config: GameConfig | Record<string, never>): Promise<string | null> {
  return ipcRenderer?.invoke(ACTIVE_GAME_SET_CONFIG, config) ?? Promise.resolve(null)
}

export function setGameRoutes(gameId: string, routes: GameRoute[]): Promise<void> {
  return ipcRenderer?.invoke(ACTIVE_GAME_SET_ROUTES, gameId, routes) ?? Promise.resolve()
}

export function startWhenReady(gameId: string): Promise<void> {
  return ipcRenderer?.invoke(ACTIVE_GAME_START_WHEN_READY, gameId) ?? Promise.resolve()
}
