export enum ChannelSettingsSection {
  General = 'General',
  Banner = 'Banner',
}

export const ALL_CHANNEL_SETTINGS_SECTIONS: ReadonlyArray<ChannelSettingsSection> =
  Object.values(ChannelSettingsSection)
