import { Record } from 'immutable'
import { MatchmakingType } from '../../common/matchmaking'
import { PartyQueueCancelReason } from '../../common/parties'
import { SbUserId } from '../../common/users/user-info'
import { BaseMessage } from '../messaging/message-records'

export enum PartyMessageType {
  SelfJoinParty = 'selfJoinParty',
  InviteToParty = 'inviteToParty',
  JoinParty = 'joinParty',
  LeaveParty = 'leaveParty',
  LeaderChange = 'leaderChange',
  KickFromParty = 'kickFromParty',
  QueueStart = 'queueStart',
  QueueCancel = 'queueCancel',
  QueueReady = 'queueReady',
}

export class SelfJoinPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.SelfJoinParty as const,
    time: 0,
    leaderId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class InviteToPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.InviteToParty as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class JoinPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.JoinParty as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class LeavePartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.LeaveParty as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class PartyLeaderChangeMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.LeaderChange as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class KickFromPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.KickFromParty as const,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class PartyQueueStartMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.QueueStart as const,
    time: 0,
    leaderId: 0 as SbUserId,
    matchmakingType: MatchmakingType.Match1v1,
  })
  implements BaseMessage {}

export class PartyQueueCancelMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.QueueCancel as const,
    time: 0,
    reason: { type: 'error' } as PartyQueueCancelReason,
  })
  implements BaseMessage {}

export class PartyQueueReadyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.QueueReady as const,
    time: 0,
  })
  implements BaseMessage {}

export type PartyMessage =
  | SelfJoinPartyMessageRecord
  | InviteToPartyMessageRecord
  | JoinPartyMessageRecord
  | LeavePartyMessageRecord
  | PartyLeaderChangeMessageRecord
  | KickFromPartyMessageRecord
  | PartyQueueStartMessageRecord
  | PartyQueueCancelMessageRecord
  | PartyQueueReadyMessageRecord
