export enum GeneralChannelSettingsPage {
  General = 'General',
}

export enum UsersChannelSettingsPage {
  Permissions = 'UsersPermissions',
}

export type ChannelSettingsPage = GeneralChannelSettingsPage | UsersChannelSettingsPage

export const ALL_CHANNEL_SETTINGS_PAGES: ReadonlyArray<ChannelSettingsPage> = [
  ...Object.values(GeneralChannelSettingsPage),
  ...Object.values(UsersChannelSettingsPage),
]
