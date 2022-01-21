import { TypedIpcRenderer } from '../../common/ipc'
import { changeUpdateState } from './updater-state'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  ipcRenderer
    .on('updaterNewVersionFound', () => {
      changeUpdateState(state => {
        state.hasUpdate = true
        state.hasDownloadError = false
        state.readyToInstall = false
      })
    })
    .on('updaterDownloadError', () => {
      changeUpdateState(state => {
        state.hasDownloadError = true
      })
    })
    .on('updaterNewVersionDownloaded', () => {
      changeUpdateState(state => {
        state.readyToInstall = true
      })
    })
    .on('updaterUpToDate', () => {
      changeUpdateState(state => {
        state.hasUpdate = false
        state.hasDownloadError = false
        state.readyToInstall = false
      })
    })

  // Trigger an initial retrieval of the update state, in case one was found before this window
  // was fully loaded
  ipcRenderer.send('updaterGetState')
}
