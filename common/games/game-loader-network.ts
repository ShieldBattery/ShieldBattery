import { GameRoute, GameSetup } from './game-launch-config'

export type GameLoaderEvent =
  | CancelLoading
  | SetGameConfigEvent
  | SetRoutesEvent
  | StartWhenReadyEvent

export interface CancelLoading {
  type: 'cancelLoading'
  gameId: string
}

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
