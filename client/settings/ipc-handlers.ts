import { TypedIpcRenderer } from '../../common/ipc'
import { SHIELDBATTERY_FILES_VALIDITY } from '../actions'
import audioManager from '../audio/audio-manager'
import { dispatch } from '../dispatch-registry'
import { handleCheckStarcraftPathResult } from '../starcraft/action-creators'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastMasterVolume: number | undefined
  let lastPath = ''
  let lastPathWasValid = false
  ipcRenderer
    .on('settingsLocalChanged', (event, settings) => {
      console.log('hello!')
      dispatch({
        type: '@settings/updateLocalSettings',
        payload: settings,
      })

      if (settings.masterVolume !== lastMasterVolume) {
        audioManager.setMasterVolume(settings.masterVolume!)
      }
      lastMasterVolume = settings.masterVolume

      if (settings.starcraftPath === lastPath && lastPathWasValid) {
        return
      }

      lastPath = settings.starcraftPath ?? ''
      lastPathWasValid = false
      ipcRenderer.invoke('settingsCheckStarcraftPath', lastPath)?.then(result => {
        lastPathWasValid = result.path && result.version
        dispatch(handleCheckStarcraftPathResult(result))
      })
    })
    .on('settingsScrChanged', (event, settings) => {
      console.log('hello!')
      dispatch({
        type: '@settings/updateScrSettings',
        payload: settings,
      })
    })

  ipcRenderer.invoke('shieldbatteryCheckFiles')?.then(fileResults => {
    dispatch({
      type: SHIELDBATTERY_FILES_VALIDITY,
      payload: fileResults,
    } as any)
  })
}
