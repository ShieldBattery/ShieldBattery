export enum UserSettingsPage {
  Account = 'UserAccount',
  Language = 'UserLanguage',
}

export enum AppSettingsPage {
  Sound = 'AppSound',
  System = 'AppSystem',
}

export enum GameSettingsPage {
  StarCraft = 'GameStarCraft',
  Input = 'GameInput',
  Sound = 'GameSound',
  Video = 'GameVideo',
  Gameplay = 'GameGameplay',
}

export type SettingsPage = UserSettingsPage | AppSettingsPage | GameSettingsPage

export const ALL_SETTINGS_PAGES: ReadonlyArray<SettingsPage> = [
  ...Object.values(UserSettingsPage),
  ...Object.values(AppSettingsPage),
  ...Object.values(GameSettingsPage),
]
