export enum UserSettingsSubPage {
  Account = 'UserAccount',
  Language = 'UserLanguage',
}

export enum AppSettingsSubPage {
  Sound = 'AppSound',
  System = 'AppSystem',
}

export enum GameSettingsSubPage {
  StarCraft = 'GameStarCraft',
  Input = 'GameInput',
  Sound = 'GameSound',
  Video = 'GameVideo',
  Gameplay = 'GameGameplay',
}

export type SettingsSubPage = UserSettingsSubPage | AppSettingsSubPage | GameSettingsSubPage

export const ALL_SETTINGS_SUB_PAGES: ReadonlyArray<SettingsSubPage> = [
  ...Object.values(UserSettingsSubPage),
  ...Object.values(AppSettingsSubPage),
  ...Object.values(GameSettingsSubPage),
]
