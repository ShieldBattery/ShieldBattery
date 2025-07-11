import { Record } from 'immutable'
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
}

export class JoinLobbyMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.JoinLobby as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class LeaveLobbyMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LeaveLobby as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class KickLobbyPlayerMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.KickLobbyPlayer as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class BanLobbyPlayerMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.BanLobbyPlayer as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class SelfJoinLobbyMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.SelfJoinLobby as const,
    time: 0,
    lobby: '',
    hostId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class LobbyHostChangeMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyHostChange as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class LobbyCountdownStartedMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownStarted as const,
    time: 0,
  })
  implements BaseMessage {}

export class LobbyCountdownTickMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownTick as const,
    time: 0,
    timeLeft: 0,
  })
  implements BaseMessage {}

export class LobbyCountdownCanceledMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownCanceled as const,
    time: 0,
  })
  implements BaseMessage {}

export class LobbyLoadingCanceledMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyLoadingCanceled as const,
    time: 0,
    usersAtFault: undefined as ReadonlyArray<SbUserId> | undefined,
  })
  implements BaseMessage {}

export type LobbyMessage =
  | JoinLobbyMessageRecord
  | LeaveLobbyMessageRecord
  | KickLobbyPlayerMessageRecord
  | BanLobbyPlayerMessageRecord
  | SelfJoinLobbyMessageRecord
  | LobbyHostChangeMessageRecord
  | LobbyCountdownStartedMessageRecord
  | LobbyCountdownTickMessageRecord
  | LobbyCountdownCanceledMessageRecord
  | LobbyLoadingCanceledMessageRecord
