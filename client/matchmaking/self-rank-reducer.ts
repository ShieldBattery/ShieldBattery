import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder/index.js'
import { MatchmakingSeasonJson, MatchmakingType } from '../../common/matchmaking.js'
import { immerKeyedReducer } from '../reducers/keyed-reducer.js'

// NOTE(tec27): This feels like a dumb thing to make a reducer for, but it doesn't really fit
// elsewhere atm :(

export interface SelfRankState {
  /** A map of matchmaking type -> rank information. */
  byType: Map<MatchmakingType, LadderPlayer>
  currentSeason: MatchmakingSeasonJson | undefined
}

const DEFAULT_STATE: Immutable<SelfRankState> = {
  byType: new Map(),
  currentSeason: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@ladder/getInstantaneousSelfRank'](state, { payload: { ranks, currentSeason } }) {
    state.byType = new Map(Object.entries(ranks) as Array<[MatchmakingType, LadderPlayer]>)
    state.currentSeason = currentSeason
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
