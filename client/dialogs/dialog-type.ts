import { SbChannelId } from '../../common/chat'
import { GameRecordJson } from '../../common/games/games'
import { ClientLeagueUserChangeJson, LeagueJson } from '../../common/leagues/leagues'
import { SbMapId } from '../../common/maps'
import { MatchmakingSeasonJson, PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'

export enum DialogType {
  AcceptableUse = 'acceptableUse',
  AcceptMatch = 'acceptMatch',
  BugReport = 'bugReport',
  ChangeEmail = 'changeEmail',
  ChangePassword = 'changePassword',
  ChannelBanUser = 'channelBanUser',
  ChannelSettings = 'channelSettings',
  Download = 'download',
  EmailVerification = 'emailVerification',
  ExternalLink = 'externalLink',
  LaunchingGame = 'launchingGame',
  LeagueExplainer = 'leagueExplainer',
  MapDetails = 'mapDetails',
  MapPreview = 'mapPreview',
  Markdown = 'markdown',
  MatchmakingBanned = 'matchmakingBanned',
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
type EmailVerificationDialogPayload = BaseDialogPayload<
  typeof DialogType.EmailVerification,
  | {
      showExplanation?: boolean
    }
  | undefined
>
type ExternalLinkDialogPayload = BaseDialogPayload<
  typeof DialogType.ExternalLink,
  {
    href: string
    domain: string
  }
>
type LaunchingGameDialogPayload = BaseDialogPayload<typeof DialogType.LaunchingGame>
type LeagueExplainerDialogPayload = BaseDialogPayload<typeof DialogType.LeagueExplainer>
type MapDetailsDialogPayload = BaseDialogPayload<
  typeof DialogType.MapDetails,
  {
    mapId: SbMapId
  }
>
type MapPreviewDialogPayload = BaseDialogPayload<
  typeof DialogType.MapPreview,
  {
    mapId: SbMapId
  }
>
type MarkdownDialogPayload = BaseDialogPayload<
  typeof DialogType.Markdown,
  {
    title: string
    markdownContent: string
    hasButton?: boolean
  }
>
type MatchmakingBannedDialogPayload = BaseDialogPayload<typeof DialogType.MatchmakingBanned>
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
  | ChangeEmailDialogPayload
  | ChangePasswordDialogPayload
  | ChannelBanUserDialogPayload
  | ChannelSettingsDialogPayload
  | DownloadDialogPayload
  | EmailVerificationDialogPayload
  | ExternalLinkDialogPayload
  | LaunchingGameDialogPayload
  | LeagueExplainerDialogPayload
  | MapDetailsDialogPayload
  | MapPreviewDialogPayload
  | MarkdownDialogPayload
  | MatchmakingBannedDialogPayload
  | PostMatchDialogPayload
  | PrivacyPolicyDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | SimpleDialogPayload
  | ShieldBatteryHealthDialogPayload
  | StarcraftHealthDialogPayload
  | TermsOfServiceDialogPayload
  | WhispersDialogPayload
