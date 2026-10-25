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
        // Also implies an update was found (this may be the only state replayed after a reload)
        state.hasUpdate = true
        state.hasDownloadError = true
        state.progress = undefined
      })
    })
    .on('updaterNewVersionDownloaded', () => {
      changeUpdateState(state => {
        state.hasUpdate = true
        state.readyToInstall = true
        state.progress = undefined
      })
    })
    .on('updaterUpToDate', () => {
      changeUpdateState(state => {
        state.hasUpdate = false
        state.hasDownloadError = false
        state.readyToInstall = false
        state.progress = undefined
      })
    })
    .on('updaterDownloadProgress', (_, info) => {
      changeUpdateState(state => {
        state.progress = { ...info }
      })
    })

  // Trigger an initial retrieval of the update state, in case one was found before this window
  // was fully loaded
  ipcRenderer.send('updaterGetState')
}
