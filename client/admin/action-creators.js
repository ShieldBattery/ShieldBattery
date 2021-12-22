import { apiUrl } from '../../common/urls'
import {
  ADMIN_MAP_POOL_CLEAR_SEARCH,
  ADMIN_MAP_POOL_CREATE,
  ADMIN_MAP_POOL_CREATE_BEGIN,
  ADMIN_MAP_POOL_DELETE,
  ADMIN_MAP_POOL_DELETE_BEGIN,
  ADMIN_MAP_POOL_GET_HISTORY,
  ADMIN_MAP_POOL_GET_HISTORY_BEGIN,
  ADMIN_MAP_POOL_SEARCH_MAPS,
  ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN,
  ADMIN_MATCHMAKING_TIMES_ADD,
  ADMIN_MATCHMAKING_TIMES_ADD_BEGIN,
  ADMIN_MATCHMAKING_TIMES_DELETE,
  ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE,
  ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
  ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
  ADMIN_MATCHMAKING_TIMES_GET_PAST,
  ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN,
} from '../actions'
import { fetchJson } from '../network/fetch'
import { openSnackbar } from '../snackbars/action-creators'

export async function fetchUserId(username) {
  const value = await fetchJson(apiUrl`admin/users/${username}`)
  if (!value.length) {
    throw new Error('No user found with that name')
  } else {
    return value[0].id
  }
}

export function searchMaps(visibility, limit, page, query = '') {
  return dispatch => {
    dispatch({ type: ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN })

    const reqUrl = `/api/1/maps?visibility=${visibility}&q=${query}&limit=${limit}&page=${page}`
    dispatch({ type: ADMIN_MAP_POOL_SEARCH_MAPS, payload: fetchJson(reqUrl) })
  }
}

export function clearSearch() {
  return {
    type: ADMIN_MAP_POOL_CLEAR_SEARCH,
  }
}

// TODO(2Pac): This can be cached
export function getMapPoolHistory(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_GET_HISTORY_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MAP_POOL_GET_HISTORY,
      payload: fetchJson(
        `/api/1/matchmaking-map-pools/${encodeURIComponent(type)}?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function createMapPool(type, maps, startDate = Date.now()) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_CREATE_BEGIN,
      meta: { type },
    })

    const params = { method: 'post', body: JSON.stringify({ maps, startDate }) }
    dispatch({
      type: ADMIN_MAP_POOL_CREATE,
      payload: fetchJson(`/api/1/matchmaking-map-pools/${encodeURIComponent(type)}`, params).then(
        mapPool => {
          dispatch(openSnackbar({ message: 'New map pool created' }))
          return mapPool
        },
      ),
      meta: { type, maps, startDate },
    })
  }
}

export function deleteMapPool(type, id) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_DELETE_BEGIN,
      meta: { type, id },
    })
    dispatch({
      type: ADMIN_MAP_POOL_DELETE,
      payload: fetchJson(`/api/1/matchmaking-map-pools/${encodeURIComponent(id)}`, {
        method: 'delete',
      }).then(() => dispatch(openSnackbar({ message: 'Map pool deleted' }))),
      meta: { type, id },
    })
  }
}

// TODO(2Pac): This can be cached
export function getMatchmakingTimesHistory(type) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_HISTORY_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_HISTORY,
      payload: fetchJson(`/api/1/matchmakingTimes/${encodeURIComponent(type)}`),
      meta: { type },
    })
  }
}

export function getMatchmakingTimesFuture(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_FUTURE_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_FUTURE,
      payload: fetchJson(
        `/api/1/matchmakingTimes/${encodeURIComponent(type)}/future?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function getMatchmakingTimesPast(type, limit, page) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_PAST_BEGIN,
      meta: { type },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_GET_PAST,
      payload: fetchJson(
        `/api/1/matchmakingTimes/${encodeURIComponent(type)}/past?limit=${limit}&page=${page}`,
      ),
      meta: { type },
    })
  }
}

export function addMatchmakingTime(type, startDate = Date.now(), enabled = false) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_ADD_BEGIN,
      meta: { type },
    })

    const params = { method: 'post', body: JSON.stringify({ startDate, enabled }) }
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_ADD,
      payload: fetchJson(`/api/1/matchmakingTimes/${encodeURIComponent(type)}`, params).then(
        matchmakingTime => {
          dispatch(openSnackbar({ message: 'New matchmaking time created' }))
          return matchmakingTime
        },
      ),
      meta: { type },
    })
  }
}

export function deleteMatchmakingTime(type, id) {
  return dispatch => {
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_DELETE_BEGIN,
      meta: { type, id },
    })
    dispatch({
      type: ADMIN_MATCHMAKING_TIMES_DELETE,
      payload: fetchJson(`/api/1/matchmakingTimes/${encodeURIComponent(id)}`, {
        method: 'delete',
      }).then(() => dispatch(openSnackbar({ message: 'Matchmaking time deleted' }))),
      meta: { type, id },
    })
  }
}
