import readFolder from './get-files'
import {
  FILE_BROWSER_CHANGE_PATH,
  FILE_BROWSER_CLEAR_FILES,
  FILE_BROWSER_GET_LIST_BEGIN,
  FILE_BROWSER_GET_LIST,
} from '../actions'

export function getFiles(browseId, path) {
  return dispatch => {
    dispatch({
      type: FILE_BROWSER_GET_LIST_BEGIN,
      payload: {
        browseId,
        path,
      },
    })

    dispatch({
      type: FILE_BROWSER_GET_LIST,
      payload: readFolder(path),
      meta: {
        browseId,
        path,
      },
    })
  }
}

export function changePath(browseId, path) {
  return {
    type: FILE_BROWSER_CHANGE_PATH,
    payload: {
      browseId,
      path,
    },
  }
}

export function clearFiles(browseId) {
  return {
    type: FILE_BROWSER_CLEAR_FILES,
    payload: { browseId },
  }
}
