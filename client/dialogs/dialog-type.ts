export enum DialogType {
  AcceptableUse = 'acceptableUse',
  AcceptMatch = 'acceptMatch',
  Account = 'account',
  Changelog = 'changelog',
  ChannelJoin = 'channelJoin',
  ChannelBanUser = 'channelBanUser',
  Download = 'download',
  ExternalLink = 'externalLink',
  MapDetails = 'mapDetails',
  MapPreview = 'mapPreview',
  PartyQueueAccept = 'partyQueueAccept',
  PartyInvite = 'partyInvite',
  PrivacyPolicy = 'privacyPolicy',
  Settings = 'settings',
  Simple = 'simple',
  ShieldBatteryHealth = 'shieldBatteryHealth',
  StarcraftHealth = 'starcraftHealth',
  StarcraftPath = 'starcraftPath',
  TermsOfService = 'termsOfService',
  Whispers = 'whispers',
}

export interface BaseDialogPayload {
  type: DialogType
  initData?: Record<string, unknown>
}

export interface AcceptableUseDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.AcceptableUse
}

export interface AcceptMatchDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.AcceptMatch
}

export interface AccountDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Account
}

export interface ChangelogDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Changelog
}

export interface ChannelJoinDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.ChannelJoin
}

export interface ChannelBanUserDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.ChannelBanUser
}

export interface DownloadDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Download
}

export interface ExternalLinkDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.ExternalLink
  initData: {
    href: string
    domain: string
  }
}

export interface MapDetailsDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.MapDetails
  initData: {
    mapId: string
  }
}

export interface MapPreviewDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.MapPreview
  initData: {
    mapId: string
  }
}

export interface PartyQueueAcceptDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.PartyQueueAccept
}

export interface PartyInviteDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.PartyInvite
}

export interface PrivacyPolicyDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.PrivacyPolicy
}

export interface SettingsDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Settings
}

export interface SimpleDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Simple
  initData: {
    simpleTitle: string
    simpleContent: React.ReactNode
    hasButton: boolean
  }
}

export interface ShieldBatteryHealthDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.ShieldBatteryHealth
}

export interface StarcraftHealthDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.StarcraftHealth
}

export interface StarcraftPathDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.StarcraftPath
}

export interface TermsOfServiceDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.TermsOfService
}

export interface WhispersDialogPayload extends BaseDialogPayload {
  type: typeof DialogType.Whispers
}

export type DialogPayload =
  | AcceptableUseDialogPayload
  | AcceptMatchDialogPayload
  | AccountDialogPayload
  | ChangelogDialogPayload
  | ChannelJoinDialogPayload
  | ChannelBanUserDialogPayload
  | DownloadDialogPayload
  | ExternalLinkDialogPayload
  | MapDetailsDialogPayload
  | MapPreviewDialogPayload
  | PartyQueueAcceptDialogPayload
  | PartyInviteDialogPayload
  | PrivacyPolicyDialogPayload
  | SettingsDialogPayload
  | SimpleDialogPayload
  | ShieldBatteryHealthDialogPayload
  | StarcraftHealthDialogPayload
  | StarcraftPathDialogPayload
  | TermsOfServiceDialogPayload
  | WhispersDialogPayload
