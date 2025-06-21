import { GameRoute } from './game-launch-config'

export type GameLoaderEvent = SetRoutesEvent

export interface SetRoutesEvent {
  type: 'setRoutes'
  gameId: string
  routes: GameRoute[]
}
