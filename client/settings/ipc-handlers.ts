import { TypedIpcRenderer } from '../../common/ipc'
import {
  LOCAL_SETTINGS_SET,
  LOCAL_SETTINGS_UPDATE,
  SCR_SETTINGS_SET,
  SCR_SETTINGS_UPDATE,
  SHIELDBATTERY_FILES_VALIDITY,
} from '../actions'
import audioManager from '../audio/audio-manager-instance'
import { dispatch } from '../dispatch-registry'
import { handleCheckStarcraftPathResult } from '../starcraft/action-creators'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastMasterVolume: number | undefined
  let lastPath = ''
  let lastPathWasValid = false
  ipcRenderer
    .on('settingsLocalChanged', (event, settings) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: settings,
      } as any)

      if (settings.masterVolume !== lastMasterVolume) {
        audioManager?.setMasterVolume(settings.masterVolume)
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
    .on('settingsLocalGetError', (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: err,
        error: true,
      } as any)
    })
    .on('settingsLocalMergeError', (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_SET,
        payload: err,
        error: true,
      } as any)
    })
    .on('settingsScrChanged', (event, settings) => {
      dispatch({
        type: SCR_SETTINGS_UPDATE,
        payload: settings,
      } as any)
    })
    .on('settingsScrGetError', (event, err) => {
      dispatch({
        type: SCR_SETTINGS_UPDATE,
        payload: err,
        error: true,
      } as any)
    })
    .on('settingsScrMergeError', (event, err) => {
      dispatch({
        type: SCR_SETTINGS_SET,
        payload: err,
        error: true,
      } as any)
    })

  // Trigger an initial update for the settings
  ipcRenderer.send('settingsLocalGet')
  ipcRenderer.send('settingsScrGet')

  ipcRenderer.invoke('shieldbatteryCheckFiles')?.then(fileResults => {
    dispatch({
      type: SHIELDBATTERY_FILES_VALIDITY,
      payload: fileResults,
    } as any)
  })
}
