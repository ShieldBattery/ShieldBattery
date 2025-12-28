import { ReadonlyDeep } from 'type-fest'
import { GameDebugInfoJson, GameRecordJson, GameReplayInfo } from '../../common/games/games'
import { PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface GameState {
  /** A map of game ID -> game information. */
  byId: Map<string, GameRecordJson>
  mmrChangesById: Map<string, Map<SbUserId, PublicMatchmakingRatingChangeJson>>
  debugInfoById: Map<string, GameDebugInfoJson>
  /** A map of game ID -> replay info (if available and user has access). */
  replayInfoById: Map<string, GameReplayInfo>
}

const DEFAULT_STATE: ReadonlyDeep<GameState> = {
  byId: new Map(),
  mmrChangesById: new Map(),
  debugInfoById: new Map(),
  replayInfoById: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/getUserProfile'](state, { payload: { matchHistory } }) {
    for (const game of matchHistory.games) {
      state.byId.set(game.id, game)
    }
  },

  ['@users/searchMatchHistory'](state, { payload: { games }, meta: { userId } }) {
    for (const game of games) {
      state.byId.set(game.id, game)
    }
  },

  ['@games/getGameRecord'](state, { payload: { game, mmrChanges, replay, debugInfo } }) {
    state.byId.set(game.id, game)
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
    if (replay) {
      state.replayInfoById.set(game.id, replay)
    }
    if (debugInfo) {
      state.debugInfoById.set(game.id, debugInfo)
    }
  },

  ['@games/gameUpdate'](state, { payload: { game, mmrChanges } }) {
    state.byId.set(game.id, game)
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
  },
})
