import fetch from '../network/fetch'
import upload from './upload'

import { openOverlay, closeOverlay } from '../activities/action-creators'
import { openSnackbar, TIMING_LONG } from '../snackbars/action-creators'
import { MAPS_LIST_GET_BEGIN, MAPS_LIST_GET, MAPS_UPLOAD_BEGIN, MAPS_UPLOAD } from '../actions'

export function uploadMap(path) {
  return async dispatch => {
    dispatch({ type: MAPS_UPLOAD_BEGIN })
    dispatch({
      type: MAPS_UPLOAD,
      payload: upload(path, '/api/1/maps')
        .then(map => {
          dispatch(openOverlay('createLobby'))

          return map
        })
        .catch(err => {
          dispatch(closeOverlay())
          dispatch(
            openSnackbar({ message: 'There was a problem uploading the map', time: TIMING_LONG }),
          )

          throw err
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
