import { Record } from 'immutable'
import { BaseMessage } from '../messaging/message-records'

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
    type: LobbyMessageType.JoinLobby,
    time: 0,
    name: '',
  })
  implements BaseMessage {}

export class LeaveLobbyMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LeaveLobby,
    time: 0,
    name: '',
  })
  implements BaseMessage {}

export class KickLobbyPlayerMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.KickLobbyPlayer,
    time: 0,
    name: '',
  })
  implements BaseMessage {}

export class BanLobbyPlayerMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.BanLobbyPlayer,
    time: 0,
    name: '',
  })
  implements BaseMessage {}

export class SelfJoinLobbyMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.SelfJoinLobby,
    time: 0,
    lobby: '',
    host: '',
  })
  implements BaseMessage {}

export class LobbyHostChangeMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyHostChange,
    time: 0,
    name: '',
  })
  implements BaseMessage {}

export class LobbyCountdownStartedMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownStarted,
    time: 0,
  })
  implements BaseMessage {}

export class LobbyCountdownTickMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownTick,
    time: 0,
    timeLeft: 0,
  })
  implements BaseMessage {}

export class LobbyCountdownCanceledMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyCountdownCanceled,
    time: 0,
  })
  implements BaseMessage {}

export class LobbyLoadingCanceledMessageRecord
  extends Record({
    id: '',
    type: LobbyMessageType.LobbyLoadingCanceled,
    time: 0,
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
