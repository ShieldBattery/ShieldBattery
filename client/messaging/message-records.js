import { Record } from 'immutable'

// id, type, and time need to be present for ALL message types
export const ChatMessage = new Record({
  id: null,
  type: 'message',
  time: 0,
  from: null,
  text: null,
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
