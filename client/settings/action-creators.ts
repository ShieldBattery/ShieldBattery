import { useHistoryState } from 'wouter/use-browser-location'
import { TypedIpcRenderer } from '../../common/ipc'
import {
  AccountSettings,
  AccountSettingsResponse,
  DEFAULT_ACCOUNT_SETTINGS,
} from '../../common/settings/account-settings'
import { LocalSettings, ScrSettings } from '../../common/settings/local-settings'
import { apiUrl } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { audioManager } from '../audio/audio-manager'
import { ThunkAction } from '../dispatch-registry'
import i18n from '../i18n/i18next'
import { pushCurrentWithState } from '../navigation/routing'
import { RequestHandlingSpec, abortableThunk } from '../network/abortable-thunk'
import { fetchJson } from '../network/fetch'
import { setUserLocalStorageValue } from '../react/state-hooks'
import { externalShowSnackbar } from '../snackbars/snackbar-controller-registry'
import { readCachedAccountSettings, writeCachedAccountSettings } from './account-settings-cache'
import { SettingsPage } from './settings-page'

const ipcRenderer = new TypedIpcRenderer()

const SETTINGS_OPEN_STATE = 'SETTINGS:open'
export const SETTINGS_PAGE_KEY = 'settingsPage'

/** Returns whether the settings UI is currently open. */
export function useIsSettingsOpen(): boolean {
  return useHistoryState() === SETTINGS_OPEN_STATE
}

/**
 * Opens the settings screen, optionally specifying a specific page to open. If the settings screen
 * is already open, it will only navigate to the new page.
 */
export function openSettings(page?: SettingsPage): ThunkAction {
  return (_, getState) => {
    if (page) {
      const userId = getState().auth.self?.user.id ?? 0
      setUserLocalStorageValue(userId, SETTINGS_PAGE_KEY, page)
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

/**
 * Applies the account settings cached from this account's last server sync, if any, so a returning
 * device shows its last-synced values before (or without) reaching the server. Intended to run at
 * session init; the account settings subscription's initial data replaces this as soon as the
 * socket connects.
 */
export function loadCachedAccountSettings(userId: SbUserId): ThunkAction {
  return dispatch => {
    dispatch({
      type: '@settings/updateAccountSettings',
      payload: readCachedAccountSettings(userId) ?? { ...DEFAULT_ACCOUNT_SETTINGS },
    })
  }
}

/**
 * Merges the given changes into the current account settings, saving the result to the server and
 * every other session logged into the account.
 */
export function mergeAccountSettings(
  settings: Partial<AccountSettings>,
  spec: RequestHandlingSpec,
): ThunkAction {
  return abortableThunk(spec, async (dispatch, getState) => {
    const {
      auth: { self },
      settings: { account: previous },
    } = getState()
    if (!self) {
      return
    }

    // Apply the change immediately so the UI feels responsive; reverted below if the server
    // rejects it.
    dispatch({
      type: '@settings/updateAccountSettings',
      payload: { ...previous, ...settings },
    })

    try {
      const result = await fetchJson<AccountSettingsResponse>(apiUrl`account-settings`, {
        method: 'POST',
        body: JSON.stringify(settings),
        signal: spec.signal,
      })

      dispatch({
        type: '@settings/updateAccountSettings',
        payload: result.settings,
      })
      writeCachedAccountSettings(self.user.id, result.settings)
    } catch (err) {
      // The server never applied the change, so undo the optimistic update above.
      dispatch({
        type: '@settings/updateAccountSettings',
        payload: previous,
      })
      externalShowSnackbar(
        i18n.t('settings.errors.save', 'There was an issue saving the settings.'),
      )
      throw err
    }
  })
}
