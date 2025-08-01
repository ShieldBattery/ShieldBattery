import { apiUrl, urlPath } from '../../common/urls'
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
} from '../actions'
import { fetchJson } from '../network/fetch'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'

export async function fetchUserId(username) {
  const value = await fetchJson(apiUrl`admin/users/${username}`)
  if (!value.length) {
    throw new Error('No user found with that name')
  } else {
    return value[0].id
  }
}

export function searchMaps(visibility, offset, query = '') {
  return dispatch => {
    dispatch({ type: ADMIN_MAP_POOL_SEARCH_MAPS_BEGIN })

    const reqUrl = urlPath`/api/1/maps?visibility=${visibility}&q=${query}&offset=${offset}`
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

export function createMapPool(type, maps, maxVetoCount, startDate = Date.now()) {
  return dispatch => {
    dispatch({
      type: ADMIN_MAP_POOL_CREATE_BEGIN,
      meta: { type },
    })

    const params = { method: 'post', body: JSON.stringify({ maps, maxVetoCount, startDate }) }
    dispatch({
      type: ADMIN_MAP_POOL_CREATE,
      payload: fetchJson(`/api/1/matchmaking-map-pools/${encodeURIComponent(type)}`, params).then(
        mapPool => {
          externalShowSnackbar('New map pool created')
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
      }).then(() => externalShowSnackbar('Map pool deleted')),
      meta: { type, id },
    })
  }
}
