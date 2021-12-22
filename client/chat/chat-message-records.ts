import { Record } from 'immutable'
import { SbUserId } from '../../common/users/sb-user'
import { BaseMessage } from '../messaging/message-records'

export enum ChatMessageType {
  JoinChannel = 'joinChannel',
  LeaveChannel = 'leaveChannel',
  NewChannelOwner = 'newOwner',
  SelfJoinChannel = 'selfJoinChannel',
}

export class JoinChannelMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.JoinChannel as typeof ChatMessageType.JoinChannel,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class LeaveChannelMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.LeaveChannel as typeof ChatMessageType.LeaveChannel,
    time: 0,
    userId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class NewChannelOwnerMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.NewChannelOwner as typeof ChatMessageType.NewChannelOwner,
    time: 0,
    newOwnerId: 0 as SbUserId,
  })
  implements BaseMessage {}

export class SelfJoinChannelMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.SelfJoinChannel as typeof ChatMessageType.SelfJoinChannel,
    time: 0,
    channel: '',
  })
  implements BaseMessage {}

export type ChatMessage =
  | JoinChannelMessageRecord
  | LeaveChannelMessageRecord
  | NewChannelOwnerMessageRecord
  | SelfJoinChannelMessageRecord
