import { ReadonlyDeep } from 'type-fest'
import { GameSource } from '../../common/games/configuration'
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
  /** Game IDs the current user could ask an admin to review, as of their last fetch. */
  reviewRequestableIds: Set<string>
}

const DEFAULT_STATE: ReadonlyDeep<GameState> = {
  byId: new Map(),
  mmrChangesById: new Map(),
  debugInfoById: new Map(),
  replayInfoById: new Map(),
  reviewRequestableIds: new Set(),
}

/**
 * Stores a games list's records, replays and rating changes. Every ranked game in the list gets an
 * entry in `mmrChangesById` (empty if it had no changes), since a list carries all of its games'
 * changes and nothing more is coming for them.
 */
function storeGameList(
  state: GameState,
  {
    games,
    replays,
    mmrChanges,
  }: {
    games: GameRecordJson[]
    replays: GameReplayInfo[]
    mmrChanges: PublicMatchmakingRatingChangeJson[]
  },
) {
  const changesByGame = new Map<string, Map<SbUserId, PublicMatchmakingRatingChangeJson>>()
  for (const change of mmrChanges) {
    let changes = changesByGame.get(change.gameId)
    if (!changes) {
      changes = new Map()
      changesByGame.set(change.gameId, changes)
    }
    changes.set(change.userId, change)
  }

  for (const game of games) {
    state.byId.set(game.id, game)
    if (game.config.gameSource === GameSource.Matchmaking && game.results) {
      state.mmrChangesById.set(game.id, changesByGame.get(game.id) ?? new Map())
    }
  }
  for (const replay of replays) {
    state.replayInfoById.set(replay.gameId, replay)
  }
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@users/getUserProfile'](state, { payload: { matchHistory } }) {
    storeGameList(state, matchHistory)
  },

  ['@users/getMatchHistory'](state, { payload }) {
    storeGameList(state, payload)
  },

  ['@games/getGames'](state, { payload }) {
    storeGameList(state, payload)
  },

  ['@games/browseGames'](state, { payload }) {
    storeGameList(state, payload)
  },

  ['@leagues/getLeagueGames'](state, { payload }) {
    storeGameList(state, payload)
  },

  ['@games/getGameRecord'](
    state,
    { payload: { game, mmrChanges, replay, debugInfo, canRequestReview } },
  ) {
    state.byId.set(game.id, game)
    if (canRequestReview) {
      state.reviewRequestableIds.add(game.id)
    } else {
      state.reviewRequestableIds.delete(game.id)
    }
    state.mmrChangesById.set(game.id, new Map(mmrChanges.map(m => [m.userId, m])))
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
