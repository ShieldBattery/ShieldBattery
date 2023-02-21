export enum UserSettingsSubPage {
  Account = 'UserSettingsAccount',
}

export enum AppSettingsSubPage {
  Sound = 'AppSettingsSound',
  System = 'AppSettingsSystem',
}

export enum GameSettingsSubPage {
  StarCraftPath = 'GameSettingsStarCraftPath',
  Input = 'GameSettingsInput',
  Sound = 'GameSettingsSound',
  Video = 'GameSettingsVideo',
  Gameplay = 'GameSettingsGameplay',
}

export type SettingsSubPage = UserSettingsSubPage | AppSettingsSubPage | GameSettingsSubPage

export const ALL_SETTINGS_SUB_PAGES: ReadonlyArray<SettingsSubPage> = [
  ...Object.values(UserSettingsSubPage),
  ...Object.values(AppSettingsSubPage),
  ...Object.values(GameSettingsSubPage),
]
