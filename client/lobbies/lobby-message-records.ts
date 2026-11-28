import {
  BestOfHostResult,
  BestOfSideIndex,
  LobbyBestOfOutcome,
  LobbyBestOfSides,
} from '../../common/lobbies/lobby-best-of'
import { LobbyChangedSetting } from '../../common/lobbies/lobby-network'
import { SbUserId } from '../../common/users/sb-user-id'
import { BaseMessage } from '../messaging/base-message-record'

export enum LobbyMessageType {
  JoinLobby = 'joinLobby',
  LeaveLobby = 'leaveLobby',
  KickLobbyPlayer = 'kickLobbyPlayer',
  BanLobbyPlayer = 'banLobbyPlayer',
  SelfJoinLobby = 'selfJoinLobby',
  LobbyHostChange = 'lobbyHostChange',
  LobbyCountdownStarted = 'lobbyCountdownStarted',
  LobbyCountdownTick = 'lobbyCountdownTick',
  LobbyCountdownCanceled = 'lobbyCountdownCanceled',
  LobbyLoadingCanceled = 'lobbyLoadingCanceled',
  LobbySettingsChange = 'lobbySettingsChange',
  LobbyBenchJoin = 'lobbyBenchJoin',
  LobbyGameStarted = 'lobbyGameStarted',
  LobbyMemberGameEnded = 'lobbyMemberGameEnded',
  LobbyRegroup = 'lobbyRegroup',
  LobbyMapQueueAdvance = 'lobbyMapQueueAdvance',
  LobbyTeamsShuffled = 'lobbyTeamsShuffled',
  LobbyPriorShuffles = 'lobbyPriorShuffles',
  LobbyBestOfStarted = 'lobbyBestOfStarted',
  LobbyBestOfEnded = 'lobbyBestOfEnded',
  LobbyBestOfCorrected = 'lobbyBestOfCorrected',
  LobbyBestOfReopened = 'lobbyBestOfReopened',
}

export interface JoinLobbyMessage extends BaseMessage {
  readonly type: LobbyMessageType.JoinLobby
  readonly userId: SbUserId
  /** Seating at arrival, preserved independently of subsequent moves and lobby settings. */
  readonly arrivalSeat?:
    | { readonly kind: 'observer' }
    | { readonly kind: 'team'; readonly teamId: number; readonly name: string }
}

export interface LeaveLobbyMessage extends BaseMessage {
  readonly type: LobbyMessageType.LeaveLobby
  readonly userId: SbUserId
}

export interface KickLobbyPlayerMessage extends BaseMessage {
  readonly type: LobbyMessageType.KickLobbyPlayer
  readonly userId: SbUserId
}

export interface BanLobbyPlayerMessage extends BaseMessage {
  readonly type: LobbyMessageType.BanLobbyPlayer
  readonly userId: SbUserId
}

export interface SelfJoinLobbyMessage extends BaseMessage {
  readonly type: LobbyMessageType.SelfJoinLobby
  readonly lobby: string
  readonly hostId: SbUserId
}

export interface LobbyHostChangeMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyHostChange
  readonly userId: SbUserId
}

export interface LobbyCountdownStartedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyCountdownStarted
}

export interface LobbyCountdownTickMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyCountdownTick
  readonly timeLeft: number
}

export interface LobbyCountdownCanceledMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyCountdownCanceled
}

export interface LobbyLoadingCanceledMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyLoadingCanceled
  readonly usersAtFault?: ReadonlyArray<SbUserId>
  readonly reason?: 'gameAnomaly'
}

export interface SettingsChangeMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbySettingsChange
  readonly changedSettings: ReadonlyArray<LobbyChangedSetting>
  /** Who made the change. Only the host can change a lobby's settings, so this is always them. */
  readonly changedBy: SbUserId
  /** Whether Warp Field ended up on, when the change turned it on or off. */
  readonly warpFieldOn?: boolean
}

export interface BenchJoinMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyBenchJoin
  readonly userId: SbUserId
}

export interface LobbyGameStartedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyGameStarted
}

export interface LobbyMemberGameEndedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyMemberGameEnded
  readonly userId: SbUserId
}

export interface LobbyRegroupMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyRegroup
  readonly gameId: string
}

/**
 * The lobby moved on to the next map in its queue after a game. Map names are captured when this
 * happens, since the queue that named them is gone by the time the message is shown.
 */
export interface LobbyMapQueueAdvanceMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyMapQueueAdvance
  /** The map the lobby moved on to, or `undefined` if none of the queued maps fit. */
  readonly mapName?: string
  /** Queued maps that were dropped without being played, since they didn't fit the settings. */
  readonly skippedMapNames: ReadonlyArray<string>
}

/** The host shuffled the teams. */
export interface TeamsShuffledMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyTeamsShuffled
  /** Who shuffled. Only the host can shuffle, so this is always them. */
  readonly userId: SbUserId
  /** How many times the teams have been shuffled, including this shuffle. */
  readonly shuffleCount: number
}

/**
 * Tells someone arriving in a lobby whose teams were already shuffled before they got there, since
 * they never saw the messages for the individual shuffles.
 */
export interface PriorShufflesMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyPriorShuffles
  readonly shuffleCount: number
}

/**
 * The host started a best-of series. Its members are captured when it starts, since the host can
 * change them while it runs. Its sides' names are not: the line reads them from the series by
 * `bestOfId` when it is shown, so it follows a rename.
 */
export interface BestOfStartedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyBestOfStarted
  /** The series' id, unique within the lobby. */
  readonly bestOfId: string
  readonly title?: string
  readonly length: number
  /** Set when the series is played to its full length. */
  readonly playAll?: true
  readonly sides: Readonly<LobbyBestOfSides>
}

/**
 * A best-of series ended: won by one side, drawn, or ended early by the host. Its members and score
 * are captured as they stood when it ended; its sides' names are read from the series by `bestOfId`
 * when the line is shown.
 */
export interface BestOfEndedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyBestOfEnded
  /** The series' id, unique within the lobby. */
  readonly bestOfId: string
  readonly sides: Readonly<LobbyBestOfSides>
  readonly score: readonly [number, number]
  readonly outcome: LobbyBestOfOutcome
}

/**
 * What a host's correction of a best-of series changed, as its chat line tells it. A game is named
 * by its number in the corrected series, captured when the correction lands, since later changes
 * to the series can renumber it.
 */
export type BestOfCorrectionRecord =
  | { readonly kind: 'gameResult'; readonly gameNumber: number; readonly result: BestOfHostResult }
  | { readonly kind: 'resultAdded'; readonly winner: BestOfSideIndex }
  | { readonly kind: 'resultRemoved'; readonly winner: BestOfSideIndex }
  | { readonly kind: 'format'; readonly length: number; readonly playAll: boolean }

/**
 * The host corrected a best-of series' results or format. Its members are captured as they stood
 * then; its sides' names are read from the series by `bestOfId` when the line is shown.
 */
export interface BestOfCorrectedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyBestOfCorrected
  /** The series' id, unique within the lobby. */
  readonly bestOfId: string
  readonly sides: Readonly<LobbyBestOfSides>
  readonly correction: BestOfCorrectionRecord
}

/**
 * A correction left a best-of series that had been won or drawn undecided, so it runs again. Its
 * score is captured as it stood then.
 */
export interface BestOfReopenedMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbyBestOfReopened
  /** The series' id, unique within the lobby. */
  readonly bestOfId: string
  readonly score: readonly [number, number]
}

export type LobbyMessage =
  | JoinLobbyMessage
  | LeaveLobbyMessage
  | KickLobbyPlayerMessage
  | BanLobbyPlayerMessage
  | SelfJoinLobbyMessage
  | LobbyHostChangeMessage
  | LobbyCountdownStartedMessage
  | LobbyCountdownTickMessage
  | LobbyCountdownCanceledMessage
  | LobbyLoadingCanceledMessage
  | SettingsChangeMessage
  | BenchJoinMessage
  | LobbyGameStartedMessage
  | LobbyMemberGameEndedMessage
  | LobbyRegroupMessage
  | LobbyMapQueueAdvanceMessage
  | TeamsShuffledMessage
  | PriorShufflesMessage
  | BestOfStartedMessage
  | BestOfEndedMessage
  | BestOfCorrectedMessage
  | BestOfReopenedMessage
