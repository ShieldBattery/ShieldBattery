import { TypedIpcRenderer } from '../../common/ipc'
import { audioManager } from '../audio/audio-manager'
import { ThunkAction } from '../dispatch-registry'
import { JsonLocalStorageValue } from '../local-storage'
import { abortableThunk, RequestHandlingSpec } from '../network/abortable-thunk'
import { ChangeSettingsSubPage, CloseSettings, OpenSettings } from './actions'
import { SettingsSubPage, UserSettingsSubPage } from './settings-sub-page'

// TODO(2Pac): Clear or migrate the previously saved tab in local storage to this?
const savedSettingsSubPage = new JsonLocalStorageValue<SettingsSubPage>('settingsSubPage')

export function openSettings(subPage?: SettingsSubPage): OpenSettings {
  return {
    type: '@settings/openSettings',
    payload: {
      subPage: subPage ?? savedSettingsSubPage.getValue() ?? UserSettingsSubPage.Account,
    },
  }
}

export function changeSettingsSubPage(subPage: SettingsSubPage): ChangeSettingsSubPage {
  savedSettingsSubPage.setValue(subPage)

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

/** Resets the master `audioManager` volume to the current value in the settings. */
export function resetMasterVolume(): ThunkAction {
  return (_, getState) => {
    const {
      settings: { local },
    } = getState()
    audioManager.setMasterVolume(local.masterVolume)
  }
}

const ipcRenderer = new TypedIpcRenderer()

export function getLocalSettings(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const settings = await ipcRenderer.invoke('settingsLocalGet')!
    dispatch({
      type: '@settings/updateLocalSettings',
      payload: settings,
    })
  })
}

export function getScrSettings(spec: RequestHandlingSpec): ThunkAction {
  return abortableThunk(spec, async dispatch => {
    const settings = await ipcRenderer.invoke('settingsScrGet')!
    dispatch({
      type: '@settings/updateScrSettings',
      payload: settings,
    })
  })
}
