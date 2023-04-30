import { TFunction } from 'i18next'
import { assertUnreachable } from '../../common/assert-unreachable'

export enum AppSettingsSubPage {
  Sound = 'AppSound',
  System = 'AppSystem',
}

export enum GameSettingsSubPage {
  StarCraft = 'StarCraft',
  Input = 'GameInput',
  Sound = 'GameSound',
  Video = 'GameVideo',
  Gameplay = 'Gameplay',
}

export type SettingsSubPage = AppSettingsSubPage | GameSettingsSubPage

export const ALL_SETTINGS_SUB_PAGES: ReadonlyArray<SettingsSubPage> = [
  ...Object.values(AppSettingsSubPage),
  ...Object.values(GameSettingsSubPage),
]

export function settingsSubPageToLabel(subPage: SettingsSubPage, t: TFunction): string {
  switch (subPage) {
    case AppSettingsSubPage.Sound:
      return t('settings.app.sound.label', 'Sound')
    case AppSettingsSubPage.System:
      return t('settings.app.system.label', 'System')
    case GameSettingsSubPage.StarCraft:
      return t('settings.game.starcraft.label', 'StarCraft')
    case GameSettingsSubPage.Input:
      return t('settings.game.input.label', 'Input')
    case GameSettingsSubPage.Sound:
      return t('settings.game.sound.label', 'Sound')
    case GameSettingsSubPage.Video:
      return t('settings.game.video.label', 'Video')
    case GameSettingsSubPage.Gameplay:
      return t('settings.game.gameplay.label', 'Gameplay')
    default:
      return assertUnreachable(subPage)
  }
}
