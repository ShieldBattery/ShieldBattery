import { dispatch } from '../dispatch-registry'
import { openDialog } from '../dialogs/dialog-action-creator'
import {
  UPDATER_NEW_VERSION_FOUND,
  UPDATER_NEW_VERSION_DOWNLOADED,
  UPDATER_UP_TO_DATE,
} from '../actions'
import {
  NEW_VERSION_DOWNLOAD_ERROR,
  NEW_VERSION_DOWNLOADED,
  NEW_VERSION_FOUND,
  NEW_VERSION_GET_STATE,
  NEW_VERSION_UP_TO_DATE,
} from '../../app/common/ipc-constants'

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer
    .on(NEW_VERSION_FOUND, () => {
      dispatch({ type: UPDATER_NEW_VERSION_FOUND })
      dispatch(openDialog('updateAvailable'))
    })
    .on(NEW_VERSION_DOWNLOAD_ERROR, () => {
      dispatch({ type: UPDATER_NEW_VERSION_DOWNLOADED, error: true })
    })
    .on(NEW_VERSION_DOWNLOADED, () => {
      dispatch({ type: UPDATER_NEW_VERSION_DOWNLOADED })
    })
    .on(NEW_VERSION_UP_TO_DATE, () => {
      dispatch({ type: UPDATER_UP_TO_DATE })
    })

  // Trigger an initial retrieval of the update state, in case one was found before this window
  // was fully loaded
  ipcRenderer.send(NEW_VERSION_GET_STATE)
}
