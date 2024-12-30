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

// NOTE(2Pac): The reason why we have two separate maps for rankings and search results is so we
// we don't have to re-fetch rankings when user clears the search query. Also, we keep the rankings
// for current season separately from previous seasons because we don't immediately know the current
// season ID.
export interface LadderState {
  /** A map of matchmaking type -> rankings. This is meant to be used for the current season. */
  typeToRankings: Map<MatchmakingType, RetrievedRankings>
  /**
   * A map of matchmaking type -> search results. This is meant to be used for the current season.
   */
  typeToSearchResults: Map<MatchmakingType, SearchResults>
  /**
   * A map of season ID -> matchmaking type -> rankings. This is meant to be used for past seasons.
   */
  seasonToTypeToRankings: Map<SeasonId, Map<MatchmakingType, RetrievedRankings>>
  /**
   * A map of season ID -> matchmaking type -> search results. This is meant to be used for past
   * seasons.
   */
  seasonToTypeToSearchResults: Map<SeasonId, Map<MatchmakingType, SearchResults>>
}

const DEFAULT_LADDER_STATE: Immutable<LadderState> = {
  typeToRankings: new Map(),
  typeToSearchResults: new Map(),
  seasonToTypeToRankings: new Map(),
  seasonToTypeToSearchResults: new Map(),
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

    if (state.seasonToTypeToRankings.has(seasonId)) {
      state.seasonToTypeToRankings.get(seasonId)!.set(matchmakingType, {
        players,
        lastUpdated,
        totalCount,
        seasonId,
        fetchTime,
      })
    } else {
      state.seasonToTypeToRankings.set(
        seasonId,
        new Map([[matchmakingType, { players, lastUpdated, totalCount, seasonId, fetchTime }]]),
      )
    }
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

    if (state.seasonToTypeToSearchResults.has(seasonId)) {
      state.seasonToTypeToSearchResults.get(seasonId)!.set(matchmakingType, {
        players,
        lastUpdated,
        totalCount,
        seasonId,
        searchQuery,
        fetchTime,
      })
    } else {
      state.seasonToTypeToSearchResults.set(
        seasonId,
        new Map([
          [matchmakingType, { players, lastUpdated, totalCount, seasonId, searchQuery, fetchTime }],
        ]),
      )
    }
  },
})
