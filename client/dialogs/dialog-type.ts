import { GameRecordJson } from '../../common/games/games'
import { PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user'

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
  PostMatch = 'postMatch',
  PrivacyPolicy = 'privacyPolicy',
  Settings = 'settings',
  Simple = 'simple',
  ShieldBatteryHealth = 'shieldBatteryHealth',
  StarcraftHealth = 'starcraftHealth',
  StarcraftPath = 'starcraftPath',
  TermsOfService = 'termsOfService',
  Whispers = 'whispers',
}

type BaseDialogPayload<D, DataType = undefined> = DataType extends undefined
  ? { type: D; initData?: undefined }
  : { type: D; initData: DataType }

type AcceptableUseDialogPayload = BaseDialogPayload<typeof DialogType.AcceptableUse>
type AcceptMatchDialogPayload = BaseDialogPayload<typeof DialogType.AcceptMatch>
type AccountDialogPayload = BaseDialogPayload<typeof DialogType.Account>
type ChangelogDialogPayload = BaseDialogPayload<typeof DialogType.Changelog>
type ChannelJoinDialogPayload = BaseDialogPayload<typeof DialogType.ChannelJoin>
type ChannelBanUserDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelBanUser,
  {
    channel: string
    userId: SbUserId
  }
>
type DownloadDialogPayload = BaseDialogPayload<typeof DialogType.Download>
type ExternalLinkDialogPayload = BaseDialogPayload<
  typeof DialogType.ExternalLink,
  {
    href: string
    domain: string
  }
>
type MapDetailsDialogPayload = BaseDialogPayload<
  typeof DialogType.MapDetails,
  {
    mapId: string
  }
>
type MapPreviewDialogPayload = BaseDialogPayload<
  typeof DialogType.MapPreview,
  {
    mapId: string
  }
>
type PartyQueueAcceptDialogPayload = BaseDialogPayload<typeof DialogType.PartyQueueAccept>
type PartyInviteDialogPayload = BaseDialogPayload<typeof DialogType.PartyInvite>
export type PostMatchDialogPayload = BaseDialogPayload<
  typeof DialogType.PostMatch,
  {
    game: GameRecordJson
    mmrChange: PublicMatchmakingRatingChangeJson
  }
>
type PrivacyPolicyDialogPayload = BaseDialogPayload<typeof DialogType.PrivacyPolicy>
type SettingsDialogPayload = BaseDialogPayload<typeof DialogType.Settings>
type SimpleDialogPayload = BaseDialogPayload<
  typeof DialogType.Simple,
  {
    simpleTitle: string
    simpleContent: React.ReactNode
    hasButton: boolean
  }
>
type ShieldBatteryHealthDialogPayload = BaseDialogPayload<typeof DialogType.ShieldBatteryHealth>
type StarcraftHealthDialogPayload = BaseDialogPayload<typeof DialogType.StarcraftHealth>
type StarcraftPathDialogPayload = BaseDialogPayload<typeof DialogType.StarcraftPath>
type TermsOfServiceDialogPayload = BaseDialogPayload<typeof DialogType.TermsOfService>
type WhispersDialogPayload = BaseDialogPayload<typeof DialogType.Whispers>

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
  | PostMatchDialogPayload
  | PrivacyPolicyDialogPayload
  | SettingsDialogPayload
  | SimpleDialogPayload
  | ShieldBatteryHealthDialogPayload
  | StarcraftHealthDialogPayload
  | StarcraftPathDialogPayload
  | TermsOfServiceDialogPayload
  | WhispersDialogPayload
