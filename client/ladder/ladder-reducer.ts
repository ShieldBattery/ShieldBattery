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
  typeToRankings: Map<MatchmakingType, RetrievedRankings>
  typeToSearchResults: Map<MatchmakingType, SearchResults>
}

const DEFAULT_LADDER_STATE: Immutable<LadderState> = {
  typeToRankings: new Map(),
  typeToSearchResults: new Map(),
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

    state.typeToRankings.set(matchmakingType, {
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

    state.typeToSearchResults.set(matchmakingType, {
      players,
      lastUpdated,
      totalCount,
      seasonId,
      searchQuery,
      fetchTime,
    })
  },
})
