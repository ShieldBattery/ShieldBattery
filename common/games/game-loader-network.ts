import { GameRoute, GameSetup } from './game-launch-config'

export type GameLoaderEvent = SetGameConfigEvent | SetRoutesEvent | StartWhenReadyEvent

export interface SetGameConfigEvent {
  type: 'setGameConfig'
  gameId: string
  setup: GameSetup
}

export interface SetRoutesEvent {
  type: 'setRoutes'
  gameId: string
  routes: GameRoute[]
}

export interface StartWhenReadyEvent {
  type: 'startWhenReady'
  gameId: string
}
