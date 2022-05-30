import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettingsData, ScrSettingsData } from '../../common/local-settings'
import { LOCAL_SETTINGS_SET_BEGIN, SCR_SETTINGS_SET_BEGIN } from '../actions'
import { audioManager } from '../audio/audio-manager'
import { DialogType } from '../dialogs/dialog-type'
import { ThunkAction } from '../dispatch-registry'
import { isStarcraftHealthy } from '../starcraft/is-starcraft-healthy'

const ipcRenderer = new TypedIpcRenderer()

export function openSettingsDialog(): ThunkAction {
  return (dispatch, getState) => {
    const { starcraft } = getState()

    if (!isStarcraftHealthy({ starcraft })) {
      dispatch({
        type: '@dialogs/open',
        payload: {
          type: DialogType.StarcraftPath,
        },
      })
    } else {
      dispatch({
        type: '@dialogs/open',
        payload: {
          type: DialogType.Settings,
        },
      })
    }
  }
}

export function mergeLocalSettings(settings: Partial<LocalSettingsData>): ThunkAction {
  return dispatch => {
    dispatch({
      type: LOCAL_SETTINGS_SET_BEGIN,
    } as any)

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send('settingsLocalMerge', settings)
  }
}

export function mergeScrSettings(settings: Partial<ScrSettingsData>): ThunkAction {
  return dispatch => {
    dispatch({
      type: SCR_SETTINGS_SET_BEGIN,
    } as any)

    // the ipc-handler will dispatch the right UPDATE event (or SET, if there was an error)
    ipcRenderer.send('settingsScrMerge', settings)
  }
}

/** Resets the master `audioManager` volume to the current value in the settings. */
export function resetMasterVolume(): ThunkAction {
  return (_, getState) => {
    const {
      settings: { local },
    } = getState()
    audioManager.setMasterVolume(local.masterVolume)
  }
}
