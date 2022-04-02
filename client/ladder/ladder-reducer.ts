import { Immutable } from 'immer'
import { LadderPlayer } from '../../common/ladder'
import { MatchmakingType } from '../../common/matchmaking'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface RetrievedRankings {
  players: LadderPlayer[]
  lastUpdated: number
  totalCount: number
}

export interface LadderState {
  typeToRankings: Map<MatchmakingType, RetrievedRankings>
}

const DEFAULT_LADDER_STATE: Immutable<LadderState> = {
  typeToRankings: new Map(),
}

export default immerKeyedReducer(DEFAULT_LADDER_STATE, {
  ['@ladder/getRankings'](state, action) {
    const { matchmakingType } = action.meta
    const { players, totalCount, lastUpdated } = action.payload

    state.typeToRankings.set(matchmakingType, { players, totalCount, lastUpdated })
  },
})
