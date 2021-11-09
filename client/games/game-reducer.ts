import { Immutable } from 'immer'
import { GameRecordJson } from '../../common/games/games'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameState {
  /** A map of game ID -> game information. */
  byId: Map<string, GameRecordJson>
}

const DEFAULT_STATE: Immutable<GameState> = {
  byId: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@profile/getUserProfile'](state, { payload: { matchHistory } }) {
    for (const game of matchHistory.games) {
      state.byId.set(game.id, game)
    }
  },

  ['@games/getGameRecord'](state, { payload: { game } }) {
    state.byId.set(game.id, game)
  },
})
