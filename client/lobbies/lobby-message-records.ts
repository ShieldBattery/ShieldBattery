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
}

export interface JoinLobbyMessage extends BaseMessage {
  readonly type: LobbyMessageType.JoinLobby
  readonly userId: SbUserId
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
