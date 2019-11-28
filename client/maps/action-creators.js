import fetch from '../network/fetch'
import upload from './upload'
import { MAP_VISIBILITY_PRIVATE, MAP_VISIBILITY_PUBLIC } from '../../app/common/constants'

import {
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  MAPS_MAP_DELETE_BEGIN,
  MAPS_MAP_DELETE,
  MAPS_MAP_UPDATE_BEGIN,
  MAPS_MAP_UPDATE,
  MAPS_TOGGLE_FAVORITE_BEGIN,
  MAPS_TOGGLE_FAVORITE,
  LOCAL_MAPS_SELECT_BEGIN,
  LOCAL_MAPS_SELECT,
} from '../actions'

const MAPS_LIMIT = 30

export function selectLocalMap(path, onMapSelect) {
  return async dispatch => {
    dispatch({ type: LOCAL_MAPS_SELECT_BEGIN })

    dispatch({
      type: LOCAL_MAPS_SELECT,
      payload: upload(path, '/api/1/maps').then(({ map }) => {
        if (onMapSelect) {
          onMapSelect(map)
        }
      }),
    })
  }
}

export function getMapsList(visibility) {
  return (dispatch, getState) => {
    dispatch({ type: MAPS_LIST_GET_BEGIN })

    const { maps } = getState()
    const reqUrl = `/api/1/maps?visibility=${visibility}&limit=${MAPS_LIMIT}&page=${maps.page}`
    dispatch({ type: MAPS_LIST_GET, payload: fetch(reqUrl) })
  }
}

export function toggleFavoriteMap(map) {
  return dispatch => {
    dispatch({ type: MAPS_TOGGLE_FAVORITE_BEGIN, meta: { map } })

    const reqUrl = `/api/1/maps/favorites/${map.id}`
    dispatch({
      type: MAPS_TOGGLE_FAVORITE,
      payload: fetch(reqUrl, { method: map.isFavorited ? 'DELETE' : 'POST' }),
      meta: { map },
    })
  }
}

function changeMapVisibility(map, visibility) {
  return dispatch => {
    dispatch({ type: MAPS_MAP_UPDATE_BEGIN, meta: { map } })

    const reqUrl = `/api/1/maps/${map.id}`
    dispatch({
      type: MAPS_MAP_UPDATE,
      payload: fetch(reqUrl, { method: 'PATCH', body: JSON.stringify({ visibility }) }),
      meta: { map },
    })
  }
}

export function makeMapPublic(map) {
  return changeMapVisibility(map, MAP_VISIBILITY_PUBLIC)
}

export function makeMapPrivate(map) {
  return changeMapVisibility(map, MAP_VISIBILITY_PRIVATE)
}

export function deleteMap(map) {
  return dispatch => {
    dispatch({ type: MAPS_MAP_DELETE_BEGIN, meta: { map } })

    const reqUrl = `/api/1/maps/${map.id}`
    dispatch({
      type: MAPS_MAP_DELETE,
      payload: fetch(reqUrl, { method: 'DELETE' }),
      meta: { map },
    })
  }
}

export function clearMapsList() {
  return {
    type: MAPS_LIST_CLEAR,
  }
}
