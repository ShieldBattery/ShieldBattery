import { List, Map, Record } from 'immutable'
import keyedReducer from '../reducers/keyed-reducer'
import {
  ADMIN_MATCHMAKING_TIMES_ADD,
  ADMIN_MATCHMAKING_TIMES_DELETE,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
} from '../actions'

export const MatchmakingTime = new Record({
  id: null,
  type: null,
  startDate: null,
  enabled: false,
})
export const MatchmakingTimesHistory = new Record({
  sortedList: new List(),

  isRequesting: false,
  lastError: null,
})
export const MatchmakingTimesState = new Record({
  types: new Map(),
})

export default keyedReducer(new MatchmakingTimesState(), {
  [ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN](state, action) {
    return state.setIn(
      ['types', action.meta.type],
      new MatchmakingTimesHistory({ isRequesting: true }),
    )
  },

  [ADMIN_MATCHMAKING_TIMES_GET_HISTORY](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type], new MatchmakingTimesHistory({ lastError: payload }))
    }

    const history = new MatchmakingTimesHistory({
      sortedList: new List(payload.map(t => new MatchmakingTime(t))),
    })
    return state.setIn(['types', meta.type], history)
  },

  [ADMIN_MATCHMAKING_TIMES_ADD](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    const history = state.types.get(meta.type)
    const updatedHistory = new MatchmakingTimesHistory({
      sortedList: history.sortedList
        .push(payload)
        .sortBy(t => t.startDate)
        .reverse(),
    })
    return state.setIn(['types', meta.type], updatedHistory)
  },

  [ADMIN_MATCHMAKING_TIMES_DELETE](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    const history = state.types.get(meta.type)
    const removedTimeIndex = history.sortedList.findIndex(t => t.id === meta.id)

    if (removedTimeIndex < 0) {
      return state
    }

    const updatedHistory = new MatchmakingTimesHistory({
      sortedList: history.sortedList.delete(removedTimeIndex),
    })
    return state.setIn(['types', meta.type], updatedHistory)
  },
})
