import { TypedIpcRenderer } from '../../common/ipc'
import {
  UPDATER_NEW_VERSION_DOWNLOADED,
  UPDATER_NEW_VERSION_FOUND,
  UPDATER_UP_TO_DATE,
} from '../actions'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { dispatch } from '../dispatch-registry'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer
    .on('updaterNewVersionFound', () => {
      dispatch({ type: UPDATER_NEW_VERSION_FOUND } as any)
      dispatch(openDialog(DialogType.UpdateAvailable))
    })
    .on('updaterDownloadError', () => {
      dispatch({ type: UPDATER_NEW_VERSION_DOWNLOADED, error: true } as any)
    })
    .on('updaterNewVersionDownloaded', () => {
      dispatch({ type: UPDATER_NEW_VERSION_DOWNLOADED } as any)
    })
    .on('updaterUpToDate', () => {
      dispatch({ type: UPDATER_UP_TO_DATE } as any)
    })

  // Trigger an initial retrieval of the update state, in case one was found before this window
  // was fully loaded
  ipcRenderer.send('updaterGetState')
}
