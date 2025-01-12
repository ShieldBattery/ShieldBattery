import { SbChannelId } from '../../common/chat'
import { GameRecordJson } from '../../common/games/games'
import { ClientLeagueUserChangeJson, LeagueJson } from '../../common/leagues'
import { MatchmakingSeasonJson, PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user'

export enum DialogType {
  AcceptableUse = 'acceptableUse',
  AcceptMatch = 'acceptMatch',
  BugReport = 'bugReport',
  Changelog = 'changelog',
  ChangeEmail = 'changeEmail',
  ChangePassword = 'changePassword',
  ChannelBanUser = 'channelBanUser',
  ChannelSettings = 'channelSettings',
  Download = 'download',
  ExternalLink = 'externalLink',
  LeagueExplainer = 'leagueExplainer',
  MapDetails = 'mapDetails',
  MapPreview = 'mapPreview',
  PostMatch = 'postMatch',
  PrivacyPolicy = 'privacyPolicy',
  ReplayInfo = 'replayInfo',
  ReplayLoad = 'replayLoad',
  Simple = 'simple',
  ShieldBatteryHealth = 'shieldBatteryHealth',
  StarcraftHealth = 'starcraftHealth',
  TermsOfService = 'termsOfService',
  Whispers = 'whispers',
}

type BaseDialogPayload<D, DataType = undefined> = DataType extends undefined
  ? { type: D; initData?: undefined }
  : { type: D; initData: DataType }

type AcceptableUseDialogPayload = BaseDialogPayload<typeof DialogType.AcceptableUse>
type AcceptMatchDialogPayload = BaseDialogPayload<typeof DialogType.AcceptMatch>
type BugReportDialogPayload = BaseDialogPayload<typeof DialogType.BugReport>
type ChangelogDialogPayload = BaseDialogPayload<typeof DialogType.Changelog>
type ChangeEmailDialogPayload = BaseDialogPayload<
  typeof DialogType.ChangeEmail,
  { currentEmail: string }
>
type ChangePasswordDialogPayload = BaseDialogPayload<typeof DialogType.ChangePassword>
type ChannelBanUserDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelBanUser,
  {
    channelId: SbChannelId
    userId: SbUserId
  }
>
export type ChannelSettingsDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelSettings,
  {
    channelId: SbChannelId
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
type LeagueExplainerDialogPayload = BaseDialogPayload<typeof DialogType.LeagueExplainer>
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
export type PostMatchDialogPayload = BaseDialogPayload<
  typeof DialogType.PostMatch,
  {
    game: GameRecordJson
    mmrChange: PublicMatchmakingRatingChangeJson
    leagueChanges: ClientLeagueUserChangeJson[]
    leagues: LeagueJson[]
    season: MatchmakingSeasonJson
    replayPath?: string
  }
>
type PrivacyPolicyDialogPayload = BaseDialogPayload<typeof DialogType.PrivacyPolicy>
type ReplayInfoDialogPayload = BaseDialogPayload<
  typeof DialogType.ReplayInfo,
  {
    filePath: string
  }
>
type ReplayLoadDialogPayload = BaseDialogPayload<
  typeof DialogType.ReplayLoad,
  {
    gameId: string
  }
>
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
type TermsOfServiceDialogPayload = BaseDialogPayload<typeof DialogType.TermsOfService>
type WhispersDialogPayload = BaseDialogPayload<typeof DialogType.Whispers>

export type DialogPayload =
  | AcceptableUseDialogPayload
  | AcceptMatchDialogPayload
  | BugReportDialogPayload
  | ChangelogDialogPayload
  | ChangeEmailDialogPayload
  | ChangePasswordDialogPayload
  | ChannelBanUserDialogPayload
  | ChannelSettingsDialogPayload
  | DownloadDialogPayload
  | ExternalLinkDialogPayload
  | LeagueExplainerDialogPayload
  | MapDetailsDialogPayload
  | MapPreviewDialogPayload
  | PostMatchDialogPayload
  | PrivacyPolicyDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | SimpleDialogPayload
  | ShieldBatteryHealthDialogPayload
  | StarcraftHealthDialogPayload
  | TermsOfServiceDialogPayload
  | WhispersDialogPayload
