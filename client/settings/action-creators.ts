import { TypedIpcRenderer } from '../../common/ipc'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { audioManager } from '../audio/audio-manager'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { pushCurrentWithState } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { SettingsPage } from './settings-page'

const ipcRenderer = new TypedIpcRenderer()

export const SETTINGS_OPEN_STATE = 'SETTINGS:open'
export const SETTINGS_PAGE_KEY = 'settingsPage'

/**
 * Opens the settings screen, optionally specifying a specific page to open. If the settings screen
 * is already open, it will only navigate to the new page.
 */
export function openSettings(page?: SettingsPage): ThunkAction {
  return (_, getState) => {
    if (page) {
      const userId = getState().auth.self?.user.id ?? 0
      const pageKey = `${userId}|${SETTINGS_PAGE_KEY}`
      localStorage.setItem(pageKey, page)
    }

    if (history.state !== SETTINGS_OPEN_STATE) {
      pushCurrentWithState(SETTINGS_OPEN_STATE)
    }
  }
}

export function closeSettings(): ThunkAction {
  return () => {
    if (history.state === SETTINGS_OPEN_STATE) {
      history.back()
    }
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
      externalShowSnackbar(
        i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
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
      externalShowSnackbar(
        i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
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
