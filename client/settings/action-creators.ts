import { TypedIpcRenderer } from '../../common/ipc.js'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings.js'
import { audioManager } from '../audio/audio-manager.js'
import { ThunkAction } from '../dispatch-registry.js'
import i18n from '../i18n/i18next.js'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk.js'
import { openSnackbar } from '../snackbars/action-creators.js'
import { ChangeSettingsSubPage, CloseSettings, OpenSettings } from './actions.js'
import { SettingsSubPage } from './settings-sub-page.js'

const ipcRenderer = new TypedIpcRenderer()

export function openSettings(subPage?: SettingsSubPage): OpenSettings {
  return {
    type: '@settings/openSettings',
    payload: {
      subPage,
    },
  }
}

export function changeSettingsSubPage(subPage: SettingsSubPage): ChangeSettingsSubPage {
  return {
    type: '@settings/changeSettingsSubPage',
    payload: { subPage },
  }
}

export function closeSettings(): CloseSettings {
  return {
    type: '@settings/closeSettings',
  }
}

export function mergeLocalSettings(
  settings: Partial<LocalSettings>,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      await ipcRenderer.invoke('settingsLocalMerge', settings)
    } catch (err) {
      dispatch(
        openSnackbar({
          message: i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
        }),
      )
    }
  })
}

export function mergeScrSettings(
  settings: Partial<ScrSettings>,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    try {
      await ipcRenderer.invoke('settingsScrMerge', settings)
    } catch (err) {
      dispatch(
        openSnackbar({
          message: i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
        }),
      )
    }
  })
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
