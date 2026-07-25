export enum GeneralChannelSettingsPage {
  General = 'General',
}

export enum UsersChannelSettingsPage {
  Permissions = 'UsersPermissions',
  BannedUsers = 'UsersBannedUsers',
}

export type ChannelSettingsPage = GeneralChannelSettingsPage | UsersChannelSettingsPage
