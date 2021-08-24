import { Immutable } from 'immer'
import {
  fromMatchmakingStatusJson,
  MatchmakingStatus,
  MatchmakingType,
} from '../../common/matchmaking'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface MatchmakingStatusState {
  byType: Map<MatchmakingType, MatchmakingStatus>
}

const DEFAULT_STATE: Immutable<MatchmakingStatusState> = {
  byType: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/statusUpdate'](state, action) {
    for (const status of action.payload) {
      state.byType.set(status.type, fromMatchmakingStatusJson(status))
    }
  },

  [NETWORK_SITE_CONNECTED as any](state: any, action: any) {
    return DEFAULT_STATE
  },
})
