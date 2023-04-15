import { audioManager } from '../audio/audio-manager'
import { ThunkAction } from '../dispatch-registry'
import { JsonLocalStorageValue } from '../local-storage'
import { ChangeSettingsSubPage, CloseSettings, OpenSettings } from './actions'
import { AppSettingsSubPage, SettingsSubPage } from './settings-sub-page'

// TODO(2Pac): Clear or migrate the previously saved tab in local storage to this?
const savedSettingsSubPage = new JsonLocalStorageValue<SettingsSubPage>('settingsSubPage')

export function openSettings(subPage?: SettingsSubPage): OpenSettings {
  return {
    type: '@settings/openSettings',
    payload: {
      subPage: subPage ?? savedSettingsSubPage.getValue() ?? AppSettingsSubPage.Sound,
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
