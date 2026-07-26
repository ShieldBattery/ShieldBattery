import { ChannelPermissions, SbChannelId } from '../../common/chat'
import { GameRecordJson } from '../../common/games/games'
import { ClientLeagueUserChangeJson, LeagueJson } from '../../common/leagues/leagues'
import { SbMapId } from '../../common/maps'
import { MatchmakingSeasonJson, PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { SbUserId } from '../../common/users/sb-user-id'

export enum DialogType {
  AcceptableUse = 'acceptableUse',
  AcceptMatch = 'acceptMatch',
  AdminDeleteChatMessage = 'adminDeleteChatMessage',
  BugReport = 'bugReport',
  ChangeDisplayName = 'changeDisplayName',
  ChangeEmail = 'changeEmail',
  ChangeLoginName = 'changeLoginName',
  ChangePassword = 'changePassword',
  ChannelBanUser = 'channelBanUser',
  ChannelKickUserConfirmation = 'channelKickUserConfirmation',
  ChannelLeaveConfirmation = 'channelLeaveConfirmation',
  ChannelTransferOwnership = 'channelTransferOwnership',
  ChannelUserPermissions = 'channelUserPermissions',
  CreatePlaylist = 'createPlaylist',
  DeletePlaylist = 'deletePlaylist',
  Download = 'download',
  EmailVerification = 'emailVerification',
  ExternalLink = 'externalLink',
  FailedToAcceptMatch = 'failedToAcceptMatch',
  LaunchingGame = 'launchingGame',
  LeagueExplainer = 'leagueExplainer',
  MapDetails = 'mapDetails',
  MapDownload = 'mapDownload',
  MapPreview = 'mapPreview',
  Markdown = 'markdown',
  MatchmakingBanned = 'matchmakingBanned',
  PostMatch = 'postMatch',
  PrivacyPolicy = 'privacyPolicy',
  RemoveUserAvatar = 'removeUserAvatar',
  RenamePlaylist = 'renamePlaylist',
  ReplayInfo = 'replayInfo',
  ReplayLoad = 'replayLoad',
  ReportGame = 'reportGame',
  Simple = 'simple',
  ShieldBatteryHealth = 'shieldBatteryHealth',
  StarcraftHealth = 'starcraftHealth',
  TermsOfService = 'termsOfService',
  Whispers = 'whispers',
}

type BaseDialogPayload<D, DataType = undefined> = DataType extends undefined
  ? { type: D; initData?: undefined; keepOnTop?: boolean }
  : { type: D; initData: DataType; keepOnTop?: boolean }

type AcceptableUseDialogPayload = BaseDialogPayload<typeof DialogType.AcceptableUse>
type AcceptMatchDialogPayload = BaseDialogPayload<typeof DialogType.AcceptMatch>
type AdminDeleteChatMessageDialogPayload = BaseDialogPayload<
  typeof DialogType.AdminDeleteChatMessage,
  {
    channelId: SbChannelId
    messageId: string
    /** Called once the message has been deleted successfully. */
    onSuccess?: () => void
  }
>
type BugReportDialogPayload = BaseDialogPayload<typeof DialogType.BugReport>
type ChangeDisplayNameDialogPayload = BaseDialogPayload<
  typeof DialogType.ChangeDisplayName,
  {
    currentName: string
    lastChange?: Date
    canChangeDisplayName: boolean
    nextDisplayNameChangeAllowedAt?: Date
  }
>
type ChangeEmailDialogPayload = BaseDialogPayload<
  typeof DialogType.ChangeEmail,
  { currentEmail: string }
>
type ChangeLoginNameDialogPayload = BaseDialogPayload<
  typeof DialogType.ChangeLoginName,
  { currentLoginName: string; lastChange?: Date }
>
type ChangePasswordDialogPayload = BaseDialogPayload<typeof DialogType.ChangePassword>
type ChannelBanUserDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelBanUser,
  {
    channelId: SbChannelId
    userId: SbUserId
    /** Called once the user has been banned successfully. */
    onSuccess?: () => void
  }
>
type ChannelKickUserConfirmationDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelKickUserConfirmation,
  {
    channelId: SbChannelId
    userId: SbUserId
    /** Called once the user has been kicked successfully. */
    onSuccess?: () => void
  }
>
type ChannelLeaveConfirmationDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelLeaveConfirmation,
  {
    channelId: SbChannelId
  }
>
type ChannelTransferOwnershipDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelTransferOwnership,
  {
    channelId: SbChannelId
    userId: SbUserId
    /**
     * The name of the channel, used to make it clear which channel is being handed over when the
     * viewer is the owner losing it. Viewers that aren't the owner (and callers that don't know
     * the name) get a generic prompt instead.
     */
    channelName?: string
    /** Called once the ownership has been transferred successfully. */
    onSuccess?: () => void
  }
>
type ChannelUserPermissionsDialogPayload = BaseDialogPayload<
  typeof DialogType.ChannelUserPermissions,
  {
    channelId: SbChannelId
    userId: SbUserId
    permissions: ChannelPermissions
    onSuccess: (userId: SbUserId, newPermissions: ChannelPermissions) => void
  }
>
type CreatePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.CreatePlaylist,
  {
    /** Called with the new playlist's id/name once it's been created (before the dialog closes). */
    onCreated: (id: number, name: string) => void
  }
>
type DeletePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.DeletePlaylist,
  {
    playlistId: number
    name: string
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
type FailedToAcceptMatchDialogPayload = BaseDialogPayload<typeof DialogType.FailedToAcceptMatch>
type LaunchingGameDialogPayload = BaseDialogPayload<typeof DialogType.LaunchingGame>
type LeagueExplainerDialogPayload = BaseDialogPayload<typeof DialogType.LeagueExplainer>
type MapDetailsDialogPayload = BaseDialogPayload<
  typeof DialogType.MapDetails,
  {
    mapId: SbMapId
  }
>
type MapDownloadDialogPayload = BaseDialogPayload<
  typeof DialogType.MapDownload,
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
type RemoveUserAvatarDialogPayload = BaseDialogPayload<
  typeof DialogType.RemoveUserAvatar,
  {
    userId: SbUserId
  }
>
type RenamePlaylistDialogPayload = BaseDialogPayload<
  typeof DialogType.RenamePlaylist,
  {
    playlistId: number
    currentName: string
  }
>
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
type ReportGameDialogPayload = BaseDialogPayload<
  typeof DialogType.ReportGame,
  {
    gameId: string
    reportedUserCandidates: SbUserId[]
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
  | AdminDeleteChatMessageDialogPayload
  | BugReportDialogPayload
  | ChannelUserPermissionsDialogPayload
  | ChangeDisplayNameDialogPayload
  | ChangeEmailDialogPayload
  | ChangeLoginNameDialogPayload
  | ChangePasswordDialogPayload
  | ChannelBanUserDialogPayload
  | ChannelKickUserConfirmationDialogPayload
  | ChannelLeaveConfirmationDialogPayload
  | ChannelTransferOwnershipDialogPayload
  | CreatePlaylistDialogPayload
  | DeletePlaylistDialogPayload
  | DownloadDialogPayload
  | EmailVerificationDialogPayload
  | ExternalLinkDialogPayload
  | FailedToAcceptMatchDialogPayload
  | LaunchingGameDialogPayload
  | LeagueExplainerDialogPayload
  | MapDetailsDialogPayload
  | MapDownloadDialogPayload
  | MapPreviewDialogPayload
  | MarkdownDialogPayload
  | MatchmakingBannedDialogPayload
  | PostMatchDialogPayload
  | PrivacyPolicyDialogPayload
  | RemoveUserAvatarDialogPayload
  | RenamePlaylistDialogPayload
  | ReplayInfoDialogPayload
  | ReplayLoadDialogPayload
  | ReportGameDialogPayload
  | SimpleDialogPayload
  | ShieldBatteryHealthDialogPayload
  | StarcraftHealthDialogPayload
  | TermsOfServiceDialogPayload
  | WhispersDialogPayload
