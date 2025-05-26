import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings } from '../../common/settings/local-settings'
import audioManager from '../audio/audio-manager'
import { dispatch } from '../dispatch-registry'
import { handleCheckStarcraftPathResult } from '../starcraft/action-creators'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastMasterVolume: number | undefined
  let lastPath = ''
  let lastPathWasValid = false
  const afterLocalSettingsChange = (settings: Partial<LocalSettings>) => {
    if (settings.masterVolume !== lastMasterVolume) {
      audioManager.setMasterVolume(settings.masterVolume!)
    }
    lastMasterVolume = settings.masterVolume

    if (settings.starcraftPath === lastPath && lastPathWasValid) {
      return
    }

    lastPath = settings.starcraftPath ?? ''
    lastPathWasValid = false
    ipcRenderer
      .invoke('settingsCheckStarcraftPath', lastPath)
      ?.then(result => {
        lastPathWasValid = result.path && result.version
        dispatch(handleCheckStarcraftPathResult(result))
      })
      .catch(swallowNonBuiltins)
  }

  ipcRenderer
    .on('settingsLocalChanged', (event, settings) => {
      dispatch({
        type: '@settings/updateLocalSettings',
        payload: settings,
      })

      afterLocalSettingsChange(settings)
    })
    .on('settingsScrChanged', (event, settings) => {
      dispatch({
        type: '@settings/updateScrSettings',
        payload: settings,
      })
    })

  // Trigger an initial update for the settings
  ipcRenderer
    .invoke('settingsLocalGet')
    ?.then(settings => {
      dispatch({
        type: '@settings/updateLocalSettings',
        payload: settings,
      })

      afterLocalSettingsChange(settings)
    })
    .catch(swallowNonBuiltins)
  ipcRenderer
    .invoke('settingsScrGet')
    ?.then(settings => {
      dispatch({
        type: '@settings/updateScrSettings',
        payload: settings,
      })
    })
    .catch(swallowNonBuiltins)

  ipcRenderer
    .invoke('shieldbatteryCheckFiles')
    ?.then(fileResults => {
      dispatch({
        type: '@starcraft/shieldBatteryFilesValidity',
        payload: fileResults,
      })
    })
    .catch(swallowNonBuiltins)
}
