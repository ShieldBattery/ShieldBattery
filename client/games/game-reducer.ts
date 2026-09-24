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
  /**
   * A map of matchmaking game ID -> the season's bonus pool as of the game's start (see
   * `GetGameResponse.rankBonusPool`).
   */
  rankBonusPoolById: Map<string, number>
}

const DEFAULT_STATE: ReadonlyDeep<GameState> = {
  byId: new Map(),
  mmrChangesById: new Map(),
  debugInfoById: new Map(),
  replayInfoById: new Map(),
  rankBonusPoolById: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/getUserProfile'](state, { payload: { matchHistory } }) {
    for (const game of matchHistory.games) {
      state.byId.set(game.id, game)
    }
    for (const replay of matchHistory.replays) {
      state.replayInfoById.set(replay.gameId, replay)
    }
  },

  ['@users/getMatchHistory'](state, { payload: { games, replays } }) {
    for (const game of games) {
      state.byId.set(game.id, game)
    }
    for (const replay of replays) {
      state.replayInfoById.set(replay.gameId, replay)
    }
  },

  ['@games/getGames'](state, { payload: { games, replays } }) {
    for (const game of games) {
      state.byId.set(game.id, game)
    }
    for (const replay of replays) {
      state.replayInfoById.set(replay.gameId, replay)
    }
  },

  ['@leagues/getLeagueGames'](state, { payload: { games, replays } }) {
    for (const game of games) {
      state.byId.set(game.id, game)
    }
    for (const replay of replays) {
      state.replayInfoById.set(replay.gameId, replay)
    }
  },

  ['@games/getGameRecord'](
    state,
    { payload: { game, mmrChanges, rankBonusPool, replay, debugInfo } },
  ) {
    state.byId.set(game.id, game)
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
    if (rankBonusPool !== undefined) {
      state.rankBonusPoolById.set(game.id, rankBonusPool)
    }
    if (replay) {
      state.replayInfoById.set(replay.gameId, replay)
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
