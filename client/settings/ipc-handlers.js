import audioManager from '../audio/audio-manager-instance'
import { dispatch } from '../dispatch-registry'
import { handleCheckStarcraftPathResult } from '../starcraft/action-creators'
import {
  LOCAL_SETTINGS_UPDATE,
  LOCAL_SETTINGS_SET,
  SCR_SETTINGS_UPDATE,
  SCR_SETTINGS_SET,
} from '../actions'
import {
  CHECK_STARCRAFT_PATH,
  LOCAL_SETTINGS_CHANGED,
  LOCAL_SETTINGS_GET,
  LOCAL_SETTINGS_GET_ERROR,
  LOCAL_SETTINGS_MERGE_ERROR,
  SCR_SETTINGS_CHANGED,
  SCR_SETTINGS_GET,
  SCR_SETTINGS_GET_ERROR,
  SCR_SETTINGS_MERGE_ERROR,
} from '../../common/ipc-constants'

export default function registerModule({ ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  let lastMasterVolume = null
  let lastPath = ''
  let lastPathWasValid = false
  ipcRenderer
    .on(LOCAL_SETTINGS_CHANGED, (event, settings) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: settings,
      })

      if (settings.masterVolume !== lastMasterVolume) {
        audioManager.setMasterVolume(settings.masterVolume)
      }
      lastMasterVolume = settings.masterVolume

      if (settings.starcraftPath === lastPath && lastPathWasValid) {
        return
      }

      lastPath = settings.starcraftPath
      lastPathWasValid = false
      ipcRenderer.invoke(CHECK_STARCRAFT_PATH, settings.starcraftPath).then(result => {
        lastPathWasValid = result.path && result.version
        dispatch(handleCheckStarcraftPathResult(result))
      })
    })
    .on(LOCAL_SETTINGS_GET_ERROR, (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_UPDATE,
        payload: err,
        error: true,
      })
    })
    .on(LOCAL_SETTINGS_MERGE_ERROR, (event, err) => {
      dispatch({
        type: LOCAL_SETTINGS_SET,
        payload: err,
        error: true,
      })
    })
    .on(SCR_SETTINGS_CHANGED, (event, settings) => {
      dispatch({
        type: SCR_SETTINGS_UPDATE,
        payload: settings,
      })
    })
    .on(SCR_SETTINGS_GET_ERROR, (event, err) => {
      dispatch({
        type: SCR_SETTINGS_UPDATE,
        payload: err,
        error: true,
      })
    })
    .on(SCR_SETTINGS_MERGE_ERROR, (event, err) => {
      dispatch({
        type: SCR_SETTINGS_SET,
        payload: err,
        error: true,
      })
    })

  // Trigger an initial update for the settings
  ipcRenderer.send(LOCAL_SETTINGS_GET)
  ipcRenderer.send(SCR_SETTINGS_GET)
}
