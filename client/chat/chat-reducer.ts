import cuid from 'cuid'
import { List, Map, OrderedSet, Record } from 'immutable'
import { ChatUser } from '../../common/chat'
import { NETWORK_SITE_CONNECTED } from '../actions'
import {
  ChatMessage,
  JoinChannelMessageRecord,
  LeaveChannelMessageRecord,
  NewChannelOwnerMessageRecord,
  SelfJoinChannelMessageRecord,
} from '../chat/chat-message-records'
import { TextMessageRecord } from '../messaging/message-records'
import { keyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_CHANNEL_MAX_HISTORY = 150

export class Users extends Record({
  active: Map<number, ChatUser>(),
  idle: Map<number, ChatUser>(),
  offline: Map<number, ChatUser>(),
}) {}

export class Channel extends Record({
  name: '',
  messages: List<ChatMessage | TextMessageRecord>(),
  users: new Users(),

  loadingHistory: false,
  hasHistory: true,

  hasLoadedUserList: false,
  loadingUserList: false,

  activated: false,
  hasUnread: false,
}) {}

export class ChatState extends Record({
  channels: OrderedSet<string>(),
  // Note that the keys for this map are always lower-case
  byName: Map<string, Channel>(),
}) {}

function updateUserState(
  user: ChatUser,
  addTo: Map<number, ChatUser>,
  removeFirst: Map<number, ChatUser>,
  removeSecond: Map<number, ChatUser>,
) {
  const addToUpdated = addTo.set(user.id, user)
  const removeFirstUpdated = removeFirst.delete(user.id)
  const removeSecondUpdated = removeSecond.delete(user.id)

  return [addToUpdated, removeFirstUpdated, removeSecondUpdated]
}

/**
 * Update the messages field for a channel, keeping the `hasUnread` flag in proper sync.
 *
 * @param updateFn A function which should perform the update operation on the messages field.
 */
function updateMessages(
  state: ChatState,
  channelName: string,
  makesUnread: boolean,
  updateFn: (
    messages: List<ChatMessage | TextMessageRecord>,
  ) => List<ChatMessage | TextMessageRecord>,
) {
  return state.updateIn(['byName', channelName.toLowerCase()], c => {
    let updated = updateFn(c.messages)
    if (updated === c.messages) {
      return c
    }

    let sliced = false
    if (!c.activated && updated.size > INACTIVE_CHANNEL_MAX_HISTORY) {
      updated = updated.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
      sliced = true
    }

    return c
      .set('messages', updated)
      .set('hasUnread', makesUnread ? c.hasUnread || !c.activated : c.hasUnread)
      .set('hasHistory', c.hasHistory || sliced)
  })
}

export default keyedReducer(new ChatState(), {
  ['@chat/initChannel'](state, action) {
    const { channel, activeChannelUsers } = action.payload
    const record = new Channel({
      name: channel,
      users: new Users({
        active: Map(activeChannelUsers.map(u => [u.id, u])),
      }),
    })
    const updated = state
      .update('channels', c => c.add(channel))
      .setIn(['byName', channel.toLowerCase()], record)

    return updateMessages(updated, channel, false, m => {
      return m.push(
        new SelfJoinChannelMessageRecord({
          id: cuid(),
          time: Date.now(),
          channel,
        }),
      )
    })
  },

  ['@chat/updateJoin'](state, action) {
    const { channel, channelUser: user } = action.payload
    const updated = state.setIn(['byName', channel.toLowerCase(), 'users', 'active', user.id], user)

    // TODO(2Pac): make this configurable
    return updateMessages(updated, channel, true, m => {
      return m.push(
        new JoinChannelMessageRecord({
          id: cuid(),
          time: Date.now(),
          user: user.name,
        }),
      )
    })
  },

  ['@chat/updateLeave'](state, action) {
    const { channel, user, newOwner } = action.payload

    let updated = state
      .deleteIn(['byName', channel.toLowerCase(), 'users', 'active', user.id])
      .deleteIn(['byName', channel.toLowerCase(), 'users', 'idle', user.id])

    // TODO(2Pac): make this configurable
    updated = updateMessages(updated, channel, true, m => {
      return m.push(
        new LeaveChannelMessageRecord({
          id: cuid(),
          time: Date.now(),
          user: user.name,
        }),
      )
    })

    return newOwner
      ? updateMessages(updated, channel, true, m => {
          return m.push(
            new NewChannelOwnerMessageRecord({
              id: cuid(),
              time: Date.now(),
              newOwner: newOwner.name,
            }),
          )
        })
      : updated
  },

  ['@chat/updateLeaveSelf'](state, action) {
    const { channel } = action.payload

    return state
      .update('channels', c => c.delete(channel))
      .deleteIn(['byName', channel.toLowerCase()])
  },

  ['@chat/updateMessage'](state, action) {
    const { id, channel, time, user, message } = action.payload
    const newMessage = new TextMessageRecord({
      id,
      time,
      from: user.name,
      text: message,
    })
    return updateMessages(state, channel, true, m => m.push(newMessage))
  },

  ['@chat/updateUserActive'](state, action) {
    const { channel, user } = action.payload
    const lowerCaseChannel = channel.toLowerCase()
    return state.updateIn(['byName', lowerCaseChannel, 'users'], (users: Users) => {
      const [active, idle, offline] = updateUserState(user, users.active, users.idle, users.offline)

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })
  },

  ['@chat/updateUserIdle'](state, action) {
    const { channel, user } = action.payload
    return state.updateIn(['byName', channel.toLowerCase(), 'users'], (users: Users) => {
      const [idle, active, offline] = updateUserState(user, users.idle, users.active, users.offline)

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })
  },

  ['@chat/updateUserOffline'](state, action) {
    const { channel, user } = action.payload
    const lowerCaseChannel = channel.toLowerCase()
    return state.updateIn(['byName', lowerCaseChannel, 'users'], (users: Users) => {
      const [offline, active, idle] = updateUserState(user, users.offline, users.active, users.idle)

      return users.set('active', active).set('idle', idle).set('offline', offline)
    })
  },

  ['@chat/loadMessageHistoryBegin'](state, action) {
    const { channel } = action.payload
    return state.setIn(['byName', channel.toLowerCase(), 'loadingHistory'], true)
  },

  ['@chat/loadMessageHistory'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return state
    }

    const { channel, limit } = action.meta
    const lowerCaseChannel = channel.toLowerCase()
    const newMessages = List(
      action.payload.map(
        msg =>
          new TextMessageRecord({
            id: msg.id,
            time: msg.sent,
            from: msg.user.name,
            text: msg.data.text,
          }),
      ),
    )
    let updated = state.setIn(['byName', lowerCaseChannel, 'loadingHistory'], false)
    if (newMessages.size < limit) {
      updated = updated.setIn(['byName', lowerCaseChannel, 'hasHistory'], false)
    }

    return updateMessages(updated, channel, false, messages => newMessages.concat(messages))
  },

  ['@chat/retrieveUserListBegin'](state, action) {
    const { channel } = action.payload
    const lowerCaseChannel = channel.toLowerCase()
    return state
      .setIn(['byName', lowerCaseChannel, 'hasLoadedUserList'], true)
      .setIn(['byName', lowerCaseChannel, 'loadingUserList'], true)
  },

  ['@chat/retrieveUserList'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return state
    }

    const { channel } = action.meta
    const lowerCaseChannel = channel.toLowerCase()
    const { channelUsers: userList } = action.payload
    return state
      .setIn(['byName', lowerCaseChannel, 'loadingUserList'], false)
      .updateIn(['byName', lowerCaseChannel, 'users'], (users: Users) => {
        const offlineArray = userList.filter(u => !users.active.has(u.id) && !users.idle.has(u.id))
        return users.set('offline', Map(offlineArray.map(u => [u.id, u])))
      })
  },

  ['@chat/activateChannel'](state, action) {
    const { channel } = action.payload
    const lowerCaseChannel = channel.toLowerCase()
    if (!state.byName.has(lowerCaseChannel)) {
      return state
    }
    return state.updateIn(['byName', lowerCaseChannel], (c: Channel) => {
      return c.set('hasUnread', false).set('activated', true)
    })
  },

  ['@chat/deactivateChannel'](state, action) {
    const { channel } = action.payload
    const lowerCaseChannel = channel.toLowerCase()
    if (!state.byName.has(lowerCaseChannel)) {
      return state
    }
    const hasHistory =
      state.byName.get(lowerCaseChannel)!.messages.size > INACTIVE_CHANNEL_MAX_HISTORY

    return state.updateIn(['byName', lowerCaseChannel], (c: Channel) => {
      return c
        .set('messages', c.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY))
        .set('hasHistory', c.hasHistory || hasHistory)
        .set('activated', false)
    })
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return new ChatState()
  },
})
