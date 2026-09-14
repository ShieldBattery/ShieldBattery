import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings } from '../../common/settings/local-settings'
import { audioManager } from '../audio/audio-manager'
import { dispatch } from '../dispatch-registry'
import { manualGameServerRegionAtom } from '../game-server-regions/game-server-regions-atoms'
import { jotaiStore } from '../jotai-store'
import { checkShieldBatteryFiles } from '../starcraft/check-shieldbattery-files-ipc'
import { starcraftPathValid, starcraftVersionValid } from '../starcraft/health-state'
import { gameDefaultsChoicePendingAtom } from './settings-atoms'

export default function registerModule({ ipcRenderer }: { ipcRenderer: TypedIpcRenderer }) {
  let lastMasterVolume: number | undefined
  let lastPath = ''
  let lastPathWasValid = false
  const afterLocalSettingsChange = (settings: Partial<LocalSettings>) => {
    jotaiStore.set(manualGameServerRegionAtom, settings.gameServerRegion)

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
        jotaiStore.set(starcraftPathValid, result.path)
        jotaiStore.set(starcraftVersionValid, result.version)
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

      if (settings.gameDefaultsPreset !== undefined) {
        // A choice was persisted, possibly by another window or a second running instance.
        jotaiStore.set(gameDefaultsChoicePendingAtom, false)
      }
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

      if (settings.gameDefaultsPreset === undefined) {
        jotaiStore.set(gameDefaultsChoicePendingAtom, true)
      }
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

  checkShieldBatteryFiles()
}
