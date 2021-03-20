import { Record } from 'immutable'

export enum ChatMessageType {
  TextMessage = 'message',
  JoinChannel = 'joinChannel',
  LeaveChannel = 'leaveChannel',
  NewChannelOwner = 'newOwner',
  SelfJoinChannel = 'selfJoinChannel',
  UserOnline = 'userOnline',
  UserOffline = 'userOffline',
}

/**
 * The base fields for all chat messages. Any added messages should implement this.
 */
interface BaseChatMessage {
  readonly id: string
  readonly type: string
  readonly time: number
}

// TODO(tec27): Write a function or something to declare just the extra parts + do the correct
// typing of the type field automatically.
export class TextMessage
  extends Record({
    id: '',
    type: ChatMessageType.TextMessage as typeof ChatMessageType.TextMessage,
    time: 0,
    from: '',
    text: '',
  })
  implements BaseChatMessage {}

export class JoinChannelMessage
  extends Record({
    id: '',
    type: ChatMessageType.JoinChannel as typeof ChatMessageType.JoinChannel,
    time: 0,
    user: '',
  })
  implements BaseChatMessage {}

export class LeaveChannelMessage
  extends Record({
    id: '',
    type: ChatMessageType.LeaveChannel as typeof ChatMessageType.LeaveChannel,
    time: 0,
    user: '',
  })
  implements BaseChatMessage {}

export class NewChannelOwnerMessage
  extends Record({
    id: '',
    type: ChatMessageType.NewChannelOwner as typeof ChatMessageType.NewChannelOwner,
    time: 0,
    newOwner: '',
  })
  implements BaseChatMessage {}

export class SelfJoinChannelMessage
  extends Record({
    id: '',
    type: ChatMessageType.SelfJoinChannel as typeof ChatMessageType.SelfJoinChannel,
    time: 0,
    channel: '',
  })
  implements BaseChatMessage {}

export class UserOnlineMessage
  extends Record({
    id: '',
    type: ChatMessageType.UserOnline as typeof ChatMessageType.UserOnline,
    time: 0,
    user: '',
  })
  implements BaseChatMessage {}

export class UserOfflineMessage
  extends Record({
    id: '',
    type: ChatMessageType.UserOffline as typeof ChatMessageType.UserOffline,
    time: 0,
    user: '',
  })
  implements BaseChatMessage {}

export type ChatMessage =
  | TextMessage
  | JoinChannelMessage
  | LeaveChannelMessage
  | NewChannelOwnerMessage
  | SelfJoinChannelMessage
  | UserOnlineMessage
  | UserOfflineMessage
