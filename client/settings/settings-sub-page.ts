export enum AppSettingsSubPage {
  Sound = 'AppSettingsSound',
  System = 'AppSettingsSystem',
}

export enum GameSettingsSubPage {
  StarCraft = 'GameSettingsStarCraft',
  Input = 'GameSettingsInput',
  Sound = 'GameSettingsSound',
  Video = 'GameSettingsVideo',
  Gameplay = 'GameSettingsGameplay',
}

export type SettingsSubPage = AppSettingsSubPage | GameSettingsSubPage

export const ALL_SETTINGS_SUB_PAGES: ReadonlyArray<SettingsSubPage> = [
  ...Object.values(AppSettingsSubPage),
  ...Object.values(GameSettingsSubPage),
]
