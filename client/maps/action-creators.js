import fetch from '../network/fetch'
import upload from './upload'

import {
  MAPS_LIST_CLEAR,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
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

export function clearMapsList() {
  return {
    type: MAPS_LIST_CLEAR,
  }
}
