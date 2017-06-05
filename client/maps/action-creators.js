import path from 'path'

import { closeOverlay, openOverlay } from '../activities/action-creators'
import { createLobby, navigateToLobby } from '../lobbies/action-creators'
import { openSnackbar } from '../snackbars/action-creators'
import fetch from '../network/fetch'
import uploadMap from './upload'
import { parseAndHashMap, tilesetIdToName } from '../../app/common/maps'

import {
  MAPS_BROWSE_SELECT,
  MAPS_HOST_LOCAL_BEGIN,
  MAPS_HOST_LOCAL,
  MAPS_LIST_GET_BEGIN,
  MAPS_LIST_GET,
} from '../actions'

export function selectLocalMap(path) {
  return async dispatch => {
    const result = await dispatch({
      type: MAPS_BROWSE_SELECT,
      payload: readMap(path).then(map => ({ map, path, }))
    })
    if (!result.error) {
      dispatch(openOverlay('createLobby'))
    }
  }
}

export function hostLocalMap(mapPath, name, map, gameType, gameSubType) {
  return async (dispatch, getState) => {
    if (getState().maps.isUploading) {
      // Users don't currently have a way to replace an ongoing upload with another,
      // hopefully it won't be necessary.
      return
    }
    dispatch({
      type: MAPS_HOST_LOCAL_BEGIN,
      payload: map,
    })
    let hadToUpload = false
    const result = await dispatch({
      type: MAPS_HOST_LOCAL,
      payload: fetch(`/api/1/maps/info/${map}`)
        .catch(err => {
          if (err.res.status !== 404) {
            throw err
          }
          hadToUpload = true
          return uploadMap(mapPath)
        }),
      meta: map,
    })
    if (!result.error) {
      if (getState().activityOverlay.overlayType === 'createLobby') {
        dispatch(createLobby(name, map, gameType, gameSubType))
        dispatch(navigateToLobby(name))
        dispatch(closeOverlay())
      } else if (hadToUpload) {
        dispatch(openSnackbar({
          message: `Map '${path.basename(mapPath)}' was uploaded succesfully`,
        }))
      }
    }
  }
}

async function readMap(filePath) {
  const extension = path.extname(filePath).slice(1)
  const { map, hash } = await parseAndHashMap(filePath, extension)
  return {
    hash,
    format: extension,
    tileset: tilesetIdToName(map.tileset),
    name: map.title,
    description: map.description,
    slots: map.maxPlayers(false),
    umsSlots: map.maxPlayers(true),
    width: map.size[0],
    height: map.size[1],
  }
}

export function getMapsList() {
  return (dispatch, getState) => {
    const { maps } = getState()
    if (maps.isFetching || (!maps.lastError && maps.list.size)) {
      return
    }

    dispatch({ type: MAPS_LIST_GET_BEGIN })
    const payload = fetch('/api/1/maps')
    dispatch({ type: MAPS_LIST_GET, payload })
  }
}
