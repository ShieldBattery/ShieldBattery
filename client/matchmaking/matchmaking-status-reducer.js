import { Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import { MATCHMAKING_STATUS_UPDATE, NETWORK_SITE_CONNECTED } from '../actions'

export const MatchmakingStatus = new Record({
  type: null,
  enabled: false,
  startDate: null,
  nextStartDate: null,
  nextEndDate: null,
})

export const MatchmakingStatusState = new Record({
  types: new Map(),
})

export default keyedReducer(new MatchmakingStatusState(), {
  [MATCHMAKING_STATUS_UPDATE](state, action) {
    const { startDate, nextStartDate, nextEndDate } = action.payload
    return state.setIn(
      ['types', action.payload.type],
      new MatchmakingStatus({
        ...action.payload,
        startDate: new Date(startDate),
        nextStartDate: new Date(nextStartDate),
        nextEndDate: new Date(nextEndDate),
      }),
    )
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new MatchmakingStatusState()
  },
})
