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
    let nextState = state

    for (const status of action.payload) {
      const { startDate, nextStartDate, nextEndDate } = status
      nextState = state.setIn(
        ['types', status.type],
        new MatchmakingStatus({
          ...status,
          startDate: new Date(startDate),
          nextStartDate: new Date(nextStartDate),
          nextEndDate: new Date(nextEndDate),
        }),
      )
    }

    return nextState
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new MatchmakingStatusState()
  },
})
