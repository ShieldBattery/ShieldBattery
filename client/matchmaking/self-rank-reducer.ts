import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder'
import { MatchmakingSeasonJson, MatchmakingType } from '../../common/matchmaking'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

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

  [NETWORK_SITE_CONNECTED as any]() {
    return DEFAULT_STATE
  },
})
