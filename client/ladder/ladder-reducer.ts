import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder/ladder'
import { MatchmakingType, SeasonId } from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedRankings {
  players: LadderPlayer[]
  lastUpdated: number
  totalCount: number
  seasonId: SeasonId
  fetchTime: Date
}

export interface SearchResults extends RetrievedRankings {
  searchQuery: string
}

export interface LadderState {
  /** A map of a matchmaking type and season ID -> rankings. */
  typeAndSeasonToRankings: Map<`${MatchmakingType}|${SeasonId}`, RetrievedRankings>
  /** A map of a matchmaking type and season ID -> search results. */
  typeAndSeasonToSearchResults: Map<`${MatchmakingType}|${SeasonId}`, SearchResults>
}

const DEFAULT_LADDER_STATE: Immutable<LadderState> = {
  typeAndSeasonToRankings: new Map(),
  typeAndSeasonToSearchResults: new Map(),
}

export default immerKeyedReducer(DEFAULT_LADDER_STATE, {
  ['@ladder/getRankings'](state, action) {
    const { matchmakingType, fetchTime } = action.meta

    const {
      players,
      lastUpdated,
      totalCount,
      season: { id: seasonId },
    } = action.payload

    state.typeAndSeasonToRankings.set(`${matchmakingType}|${seasonId}`, {
      players,
      lastUpdated,
      totalCount,
      seasonId,
      fetchTime,
    })
  },

  ['@ladder/searchRankings'](state, action) {
    const { matchmakingType, searchQuery, fetchTime } = action.meta

    const {
      players,
      lastUpdated,
      totalCount,
      season: { id: seasonId },
    } = action.payload

    state.typeAndSeasonToSearchResults.set(`${matchmakingType}|${seasonId}`, {
      players,
      lastUpdated,
      totalCount,
      seasonId,
      fetchTime,
      searchQuery,
    })
  },
})
