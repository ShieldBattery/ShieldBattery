import { Record } from 'immutable'
import { BaseMessage } from '../messaging/message-records'

export enum PartyMessageType {
  SelfJoinParty = 'selfJoinParty',
  InviteToParty = 'InviteToParty',
  JoinParty = 'joinParty',
  LeaveParty = 'leaveParty',
}

export class SelfJoinPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.SelfJoinParty as typeof PartyMessageType.SelfJoinParty,
    time: 0,
    leaderId: 0,
  })
  implements BaseMessage {}

export class InviteToPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.InviteToParty as typeof PartyMessageType.InviteToParty,
    time: 0,
    userId: 0,
  })
  implements BaseMessage {}

export class JoinPartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.JoinParty as typeof PartyMessageType.JoinParty,
    time: 0,
    userId: 0,
  })
  implements BaseMessage {}

export class LeavePartyMessageRecord
  extends Record({
    id: '',
    type: PartyMessageType.LeaveParty as typeof PartyMessageType.LeaveParty,
    time: 0,
    userId: 0,
  })
  implements BaseMessage {}

export type PartyMessage =
  | SelfJoinPartyMessageRecord
  | InviteToPartyMessageRecord
  | JoinPartyMessageRecord
  | LeavePartyMessageRecord
