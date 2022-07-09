import { ReadonlyDeep } from 'type-fest'
import { ReportedGameStatus } from '../../common/game-status'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameClientState {
  gameId?: string
  status?: ReportedGameStatus
}

const DEFAULT_STATE: ReadonlyDeep<GameClientState> = {
  gameId: undefined,
  status: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@active-game/launch'](state, action) {
    if (action.error) {
      return DEFAULT_STATE
    }

    return action.payload === null ? DEFAULT_STATE : { gameId: action.payload }
  },

  ['@active-game/status'](state, { payload }) {
    state.gameId = payload.id
    state.status = { ...payload }
  },
})
