import fetch from '../network/fetch'
import upload from './upload'

import {
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  LOCAL_MAPS_SELECT_BEGIN,
  LOCAL_MAPS_SELECT,
} from '../actions'

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

export function getMapsList(visibility, limit, pageNumber) {
  return dispatch => {
    dispatch({ type: MAPS_LIST_GET_BEGIN })

    const reqUrl = `/api/1/maps?visibility=${visibility}&limit=${limit}&page=${pageNumber}`
    dispatch({ type: MAPS_LIST_GET, payload: fetch(reqUrl) })
  }
}

export function clearMapsList() {
  return {
    type: MAPS_LIST_CLEAR,
  }
}
