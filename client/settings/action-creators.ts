import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { audioManager } from '../audio/audio-manager'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { openSnackbar } from '../snackbars/action-creators'
import { ChangeSettingsSubPage, CloseSettings, OpenSettings } from './actions'
import { SettingsSubPage } from './settings-sub-page'

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
          message: i18n.t('settings.errors.merge', 'There was an issue saving the settings.'),
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
          message: i18n.t('settings.errors.merge', 'There was an issue saving the settings.'),
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
