import { Record } from 'immutable'

// id, type, and time need to be present for ALL message types
export const ChatMessage = new Record({
  id: null,
  type: 'message',
  time: 0,
  from: null,
  text: null,
})
export const JoinChannelMessage = new Record({
  id: null,
  type: 'joinChannel',
  time: 0,
  user: null,
})
export const LeaveChannelMessage = new Record({
  id: null,
  type: 'leaveChannel',
  time: 0,
  user: null,
})
export const NewChannelOwnerMessage = new Record({
  id: null,
  type: 'newOwner',
  time: 0,
  newOwner: null,
})
export const SelfJoinChannelMessage = new Record({
  id: null,
  type: 'selfJoinChannel',
  channel: null,
})
export const UserOnlineMessage = new Record({
  id: null,
  type: 'userOnline',
  time: 0,
  user: null,
})
export const UserOfflineMessage = new Record({
  id: null,
  type: 'userOffline',
  time: 0,
  user: null,
})
