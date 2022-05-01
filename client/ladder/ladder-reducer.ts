import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedRankings {
  players: LadderPlayer[]
  lastUpdated: number
  totalCount: number
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

    state.typeToRankings.set(matchmakingType, { ...action.payload, fetchTime })
  },

  ['@ladder/searchRankings'](state, action) {
    const { matchmakingType, searchQuery, fetchTime } = action.meta

    state.typeToSearchResults.set(matchmakingType, { ...action.payload, searchQuery, fetchTime })
  },
})
