export enum GeneralChannelSettingsPage {
  General = 'General',
}

export enum UsersChannelSettingsPage {
  Permissions = 'UsersPermissions',
}

export type ChannelSettingsPage = GeneralChannelSettingsPage | UsersChannelSettingsPage
