import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson } from '../../common/games/games'
import { PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameState {
  /** A map of game ID -> game information. */
  byId: Map<string, GameRecordJson>
  mmrChangesById: Map<string, Map<SbUserId, PublicMatchmakingRatingChangeJson>>
}

const DEFAULT_STATE: ReadonlyDeep<GameState> = {
  byId: new Map(),
  mmrChangesById: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/getUserProfile'](state, { payload: { matchHistory } }) {
    for (const game of matchHistory.games) {
      state.byId.set(game.id, game)
    }
  },

  ['@games/getGameRecord'](state, { payload: { game, mmrChanges } }) {
    state.byId.set(game.id, game)
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
  },

  ['@games/gameUpdate'](state, { payload: { game, mmrChanges } }) {
    state.byId.set(game.id, game)
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
  },
})
