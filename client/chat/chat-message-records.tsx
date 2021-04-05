import { Record } from 'immutable'
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
    type: ChatMessageType.JoinChannel,
    time: 0,
    user: '',
  })
  implements BaseMessage {}

export class LeaveChannelMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.LeaveChannel,
    time: 0,
    user: '',
  })
  implements BaseMessage {}

export class NewChannelOwnerMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.NewChannelOwner,
    time: 0,
    newOwner: '',
  })
  implements BaseMessage {}

export class SelfJoinChannelMessageRecord
  extends Record({
    id: '',
    type: ChatMessageType.SelfJoinChannel,
    time: 0,
    channel: '',
  })
  implements BaseMessage {}

export type ChatMessage =
  | JoinChannelMessageRecord
  | LeaveChannelMessageRecord
  | NewChannelOwnerMessageRecord
  | SelfJoinChannelMessageRecord
