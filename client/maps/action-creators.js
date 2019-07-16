import fetch from '../network/fetch'
import upload from './upload'

import { openOverlay } from '../activities/action-creators'
import {
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  LOCAL_MAPS_UPLOAD_BEGIN,
  LOCAL_MAPS_UPLOAD,
} from '../actions'

export function uploadMap(path) {
  return dispatch => {
    dispatch({ type: LOCAL_MAPS_UPLOAD_BEGIN })
    dispatch({
      type: LOCAL_MAPS_UPLOAD,
      payload: upload(path, '/api/1/maps').then(map => {
        dispatch(openOverlay('createLobby'))

        return map
      }),
    })
  }
}

export function getMapsList() {
  return dispatch => {
    dispatch({ type: MAPS_LIST_GET_BEGIN })
    dispatch({ type: MAPS_LIST_GET, payload: fetch('/api/1/maps') })
  }
}
