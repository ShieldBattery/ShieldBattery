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
}

export interface SettingsChangeMessage extends BaseMessage {
  readonly type: LobbyMessageType.LobbySettingsChange
  readonly changedSettings: ReadonlyArray<LobbyChangedSetting>
  /** Who made the change. Only the host can change a lobby's settings, so this is always them. */
  readonly changedBy: SbUserId
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
