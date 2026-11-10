import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder/ladder'
import { MatchmakingSeasonJson, MatchmakingType } from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// NOTE(tec27): This feels like a dumb thing to make a reducer for, but it doesn't really fit
// elsewhere atm :(

/**
 * The current user's standing in one matchmaking type. This is limited to what a game's matchmaking
 * results also carry, so the standing can be kept current from them without another request.
 */
export type SelfRank = Pick<
  LadderPlayer,
  'matchmakingType' | 'rating' | 'points' | 'bonusUsed' | 'lifetimeGames' | 'wins' | 'losses'
>

export interface SelfRankState {
  /** A map of matchmaking type -> rank information. */
  byType: Map<MatchmakingType, SelfRank>
  currentSeason: MatchmakingSeasonJson | undefined
}

const DEFAULT_STATE: Immutable<SelfRankState> = {
  byType: new Map(),
  currentSeason: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@ladder/getInstantaneousSelfRank'](state, { payload: { ranks, currentSeason } }) {
    state.byType = new Map(Object.entries(ranks) as Array<[MatchmakingType, SelfRank]>)
    state.currentSeason = currentSeason
  },

  ['@matchmaking/resultsReceived'](state, { payload: { mmrChange, season } }) {
    // Standings are per-season, so results for a game from another season say nothing about this
    // one. This also covers the standings not having been loaded yet.
    if (state.currentSeason?.id !== season.id) {
      return
    }

    // Results describe the standing as of their own game, and they can arrive for a game that isn't
    // the newest one (e.g. one that was resolved late). `lifetimeGames` grows with every game, so
    // results that don't advance it are for a game the standing already includes.
    const current = state.byType.get(mmrChange.matchmakingType)
    if (current && mmrChange.lifetimeGames <= current.lifetimeGames) {
      return
    }

    state.byType.set(mmrChange.matchmakingType, {
      matchmakingType: mmrChange.matchmakingType,
      rating: mmrChange.rating,
      points: mmrChange.points,
      bonusUsed: mmrChange.bonusUsed,
      lifetimeGames: mmrChange.lifetimeGames,
      wins: (current?.wins ?? 0) + (mmrChange.outcome === 'win' ? 1 : 0),
      losses: (current?.losses ?? 0) + (mmrChange.outcome === 'loss' ? 1 : 0),
    })
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
