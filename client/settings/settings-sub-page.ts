export enum UserSettingsSubPage {
  Language = 'UserLanguage',
}

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

export type SettingsSubPage = UserSettingsSubPage | AppSettingsSubPage | GameSettingsSubPage

export const ALL_SETTINGS_SUB_PAGES: ReadonlyArray<SettingsSubPage> = [
  ...Object.values(UserSettingsSubPage),
  ...Object.values(AppSettingsSubPage),
  ...Object.values(GameSettingsSubPage),
]
