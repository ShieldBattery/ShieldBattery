import { List, Map, Record, Set } from 'immutable'
import {
  ADMIN_MATCHMAKING_TIMES_ADD,
  ADMIN_MATCHMAKING_TIMES_DELETE,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_PAST,
  ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN,
} from '../actions'
import { keyedReducer } from '../reducers/keyed-reducer'

export const MatchmakingTime = Record({
  id: null,
  type: null,
  startDate: null,
  enabled: false,
})
export const MatchmakingTimesHistory = Record({
  currentTime: null,
  futureTimes: new List(),
  totalFutureTimes: -1,
  pastTimes: new List(),
  totalPastTimes: -1,

  isRequesting: false,
  isRequestingFutureTimes: false,
  isRequestingPastTimes: false,
  lastError: null,
})
export const MatchmakingTimesState = Record({
  types: new Map(),
})

function createMatchmakingTime(time) {
  if (!time) {
    return null
  }

  return new MatchmakingTime({ ...time, startDate: new Date(time.startDate) })
}

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

    const { current, futureTimes, totalFutureTimes, pastTimes, totalPastTimes } = payload
    const history = new MatchmakingTimesHistory({
      currentTime: createMatchmakingTime(current),
      futureTimes: new List(futureTimes.map(t => createMatchmakingTime(t))),
      totalFutureTimes,
      pastTimes: new List(pastTimes.map(t => createMatchmakingTime(t))),
      totalPastTimes,
    })
    return state.setIn(['types', meta.type], history)
  },

  [ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN](state, action) {
    return state.setIn(['types', action.meta.type, 'isRequestingFutureTimes'], true)
  },

  [ADMIN_MATCHMAKING_TIMES_GET_FUTURE](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state
        .setIn(['types', meta.type, 'lastError'], payload)
        .setIn(['types', meta.type, 'isRequestingFutureTimes'], false)
    }

    const futureTimes = new List(payload.futureTimes.map(t => createMatchmakingTime(t)))
    return state
      .setIn(['types', meta.type, 'lastError'], null)
      .setIn(['types', meta.type, 'isRequestingFutureTimes'], false)
      .setIn(['types', meta.type, 'totalFutureTimes'], payload.totalFutureTimes)
      .updateIn(['types', meta.type, 'futureTimes'], existingTimes => {
        // Filter the matchmaking times that were already added through the `ADD` action
        const timesSet = new Set(existingTimes.concat(futureTimes))

        return timesSet
          .toList()
          .sortBy(t => t.startDate)
          .reverse()
      })
  },

  [ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN](state, action) {
    return state.setIn(['types', action.meta.type, 'isRequestingPastTimes'], true)
  },

  [ADMIN_MATCHMAKING_TIMES_GET_PAST](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state
        .setIn(['types', meta.type, 'lastError'], payload)
        .setIn(['types', meta.type, 'isRequestingPastTimes'], false)
    }

    const pastTimes = new List(payload.pastTimes.map(t => createMatchmakingTime(t)))
    return state
      .setIn(['types', meta.type, 'lastError'], null)
      .setIn(['types', meta.type, 'isRequestingPastTimes'], false)
      .setIn(['types', meta.type, 'totalPastTimes'], payload.totalPastTimes)
      .updateIn(['types', meta.type, 'pastTimes'], times => times.concat(pastTimes))
  },

  [ADMIN_MATCHMAKING_TIMES_ADD](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    return state.updateIn(['types', meta.type, 'futureTimes'], futureTimes =>
      futureTimes
        .push(createMatchmakingTime(payload))
        .sortBy(t => t.startDate)
        .reverse(),
    )
  },

  [ADMIN_MATCHMAKING_TIMES_DELETE](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['types', meta.type, 'lastError'], payload)
    }

    const history = state.types.get(meta.type)
    const removedTimeIndex = history.futureTimes.findIndex(t => t.id === meta.id)

    if (removedTimeIndex < 0) {
      return state
    }

    return state.setIn(
      ['types', meta.type, 'futureTimes'],
      history.futureTimes.delete(removedTimeIndex),
    )
  },
})
