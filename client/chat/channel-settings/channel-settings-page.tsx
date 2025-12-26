export enum GeneralChannelSettingsPage {
  General = 'General',
}

export type ChannelSettingsPage = GeneralChannelSettingsPage

export const ALL_CHANNEL_SETTINGS_PAGES: ReadonlyArray<ChannelSettingsPage> = [
  ...Object.values(GeneralChannelSettingsPage),
]
