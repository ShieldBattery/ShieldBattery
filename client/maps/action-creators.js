import fetch from '../network/fetch'
import upload from './upload'

import { openOverlay } from '../activities/action-creators'
import {
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
  LOCAL_MAPS_SELECT_BEGIN,
  LOCAL_MAPS_SELECT,
} from '../actions'

export function selectLocalMap(path) {
  return async dispatch => {
    dispatch({ type: LOCAL_MAPS_SELECT_BEGIN })

    // Have to use `await` here so the "create lobby" overlay is not opened before this action's
    // reducer gets called and sets the selected map
    await dispatch({
      type: LOCAL_MAPS_SELECT,
      payload: upload(path, '/api/1/maps'),
    })
    dispatch(openOverlay('createLobby'))
  }
}

export function getMapsList() {
  return dispatch => {
    dispatch({ type: MAPS_LIST_GET_BEGIN })
    dispatch({ type: MAPS_LIST_GET, payload: fetch('/api/1/maps') })
  }
}
