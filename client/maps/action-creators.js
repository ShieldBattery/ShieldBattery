import fetch from '../network/fetch'
import upload from './upload'
import { MAP_VISIBILITY_PRIVATE, MAP_VISIBILITY_PUBLIC } from '../../app/common/constants'

import {
  LOCAL_MAPS_SELECT_BEGIN,
  LOCAL_MAPS_SELECT,
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  MAPS_REMOVE_BEGIN,
  MAPS_REMOVE,
  MAPS_TOGGLE_FAVORITE_BEGIN,
  MAPS_TOGGLE_FAVORITE,
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

export function removeMap(map) {
  return dispatch => {
    dispatch({ type: MAPS_REMOVE_BEGIN, meta: { map } })

    dispatch({
      type: MAPS_REMOVE,
      payload: fetch(`/api/1/maps/${map.id}`, { method: 'DELETE' }),
      meta: { map },
    })
  }
}

export function clearMapsList() {
  return {
    type: MAPS_LIST_CLEAR,
  }
}
