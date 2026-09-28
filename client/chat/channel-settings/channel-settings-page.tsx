export enum GeneralChannelSettingsPage {
  General = 'General',
}

export enum UsersChannelSettingsPage {
  Permissions = 'UsersPermissions',
  BannedUsers = 'UsersBannedUsers',
  InviteLinks = 'UsersInviteLinks',
}

export type ChannelSettingsPage = GeneralChannelSettingsPage | UsersChannelSettingsPage
