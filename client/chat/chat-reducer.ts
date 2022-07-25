import cuid from 'cuid'
import { Immutable } from 'immer'
import {
  ChannelModerationAction,
  ChannelPermissions,
  ChatMessage,
  ChatUserProfileJson,
  ClientChatMessageType,
  SbChannelId,
} from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_CHANNEL_MAX_HISTORY = 150

export interface UsersState {
  active: Set<SbUserId>
  idle: Set<SbUserId>
  offline: Set<SbUserId>
}

export interface ChannelState {
  id: SbChannelId
  name: string
  messages: ChatMessage[]
  users: UsersState
  userProfiles: Map<SbUserId, ChatUserProfileJson>
  selfPermissions: ChannelPermissions
  ownerId: SbUserId

  loadingHistory: boolean
  hasHistory: boolean

  hasLoadedUserList: boolean
  loadingUserList: boolean

  activated: boolean
  hasUnread: boolean
}

export interface ChatState {
  channels: Set<SbChannelId>
  byId: Map<SbChannelId, ChannelState>
}

const DEFAULT_CHAT_STATE: Immutable<ChatState> = {
  channels: new Set(),
  byId: new Map(),
}

function removeUserFromChannel(
  state: ChatState,
  channelId: SbChannelId,
  userId: SbUserId,
  newOwnerId?: SbUserId,
  reason?: ChannelModerationAction,
) {
  const channel = state.byId.get(channelId)
  if (!channel) {
    return
  }

  channel.users.active.delete(userId)
  channel.users.idle.delete(userId)
  channel.users.offline.delete(userId)
  channel.userProfiles.delete(userId)

  let messageType:
    | ClientChatMessageType.LeaveChannel
    | ClientChatMessageType.KickUser
    | ClientChatMessageType.BanUser = ClientChatMessageType.LeaveChannel
  if (reason === ChannelModerationAction.Kick) {
    messageType = ClientChatMessageType.KickUser
  } else if (reason === ChannelModerationAction.Ban) {
    messageType = ClientChatMessageType.BanUser
  }

  updateMessages(state, channelId, true, m =>
    m.concat({
      id: cuid(),
      type: messageType,
      channelId,
      time: Date.now(),
      userId,
    }),
  )

  if (newOwnerId) {
    channel.ownerId = newOwnerId

    updateMessages(state, channelId, true, m =>
      m.concat({
        id: cuid(),
        type: ClientChatMessageType.NewChannelOwner,
        channelId,
        time: Date.now(),
        newOwnerId,
      }),
    )
  }
}

/**
 * Update the messages field for a channel, keeping the `hasUnread` flag in proper sync.
 *
 * @param state The complete chat state which holds all of the channels.
 * @param channelId The ID of the channel in which to update the messages.
 * @param makesUnread A boolean flag indicating whether to mark a channel as having unread messages.
 * @param updateFn A function which should perform the update operation on the messages field. Note
 *   that this function should return a new array, instead of performing the update in-place.
 */
function updateMessages(
  state: ChatState,
  channelId: SbChannelId,
  makesUnread: boolean,
  updateFn: (messages: ChatMessage[]) => ChatMessage[],
) {
  const channel = state.byId.get(channelId)
  if (!channel) {
    return
  }

  channel.messages = updateFn(channel.messages)

  let sliced = false
  if (!channel.activated && channel.messages.length > INACTIVE_CHANNEL_MAX_HISTORY) {
    channel.messages = channel.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    sliced = true
  }

  channel.hasUnread = makesUnread ? channel.hasUnread || !channel.activated : channel.hasUnread
  channel.hasHistory = channel.hasHistory || sliced
}

export default immerKeyedReducer(DEFAULT_CHAT_STATE, {
  ['@chat/initChannel'](state, action) {
    const { channelInfo, activeUserIds, selfPermissions } = action.payload
    const { channelId } = action.meta

    const channelUsers: UsersState = {
      active: new Set(activeUserIds),
      idle: new Set(),
      offline: new Set(),
    }
    const channelState: ChannelState = {
      id: channelId,
      name: channelInfo.name,
      messages: [],
      users: channelUsers,
      selfPermissions,
      ownerId: channelInfo.ownerId,
      userProfiles: new Map(),
      loadingHistory: false,
      hasHistory: true,
      hasLoadedUserList: false,
      loadingUserList: false,
      activated: false,
      hasUnread: false,
    }
    state.channels.add(channelId)
    state.byId.set(channelId, channelState)

    updateMessages(state, channelId, false, m =>
      m.concat({
        id: cuid(),
        type: ClientChatMessageType.SelfJoinChannel,
        channelId,
        time: Date.now(),
      }),
    )
  },

  ['@chat/updateJoin'](state, action) {
    const { user, message } = action.payload
    const { channelId } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.users.active.add(user.id)

    updateMessages(state, channelId, true, m => m.concat(message))
  },

  ['@chat/updateLeave'](state, action) {
    const { userId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, userId, newOwnerId)
  },

  ['@chat/updateLeaveSelf'](state, action) {
    const { channelId } = action.meta

    state.channels.delete(channelId)
    state.byId.delete(channelId)
  },

  ['@chat/updateKick'](state, action) {
    const { targetId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, targetId, newOwnerId, ChannelModerationAction.Kick)
  },

  ['@chat/updateKickSelf'](state, action) {
    const { channelId } = action.meta

    state.channels.delete(channelId)
    state.byId.delete(channelId)
  },

  ['@chat/updateBan'](state, action) {
    const { targetId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, targetId, newOwnerId, ChannelModerationAction.Ban)
  },

  ['@chat/updateBanSelf'](state, action) {
    const { channelId } = action.meta

    state.channels.delete(channelId)
    state.byId.delete(channelId)
  },

  ['@chat/updateMessage'](state, action) {
    const { message: newMessage } = action.payload
    const { channelId } = action.meta

    updateMessages(state, channelId, true, m => m.concat(newMessage))
  },

  ['@chat/updateUserActive'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.users.active.add(userId)
    channel.users.idle.delete(userId)
    channel.users.offline.delete(userId)
  },

  ['@chat/updateUserIdle'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.users.idle.add(userId)
    channel.users.active.delete(userId)
    channel.users.offline.delete(userId)
  },

  ['@chat/updateUserOffline'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.users.offline.add(userId)
    channel.users.active.delete(userId)
    channel.users.idle.delete(userId)
  },

  ['@chat/loadMessageHistoryBegin'](state, action) {
    const { channelId } = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.loadingHistory = true
  },

  ['@chat/loadMessageHistory'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    const { channelId, limit } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    // Even though the payload here is `ServerChatMessage`, we expand its type so it can be
    // concatenated with the existing messages which could also contain client chat messages.
    const newMessages = action.payload.messages as ChatMessage[]

    channel.loadingHistory = false
    if (newMessages.length < limit) {
      channel.hasHistory = false
    }

    updateMessages(state, channelId, false, messages => newMessages.concat(messages))
  },

  ['@chat/retrieveUserListBegin'](state, action) {
    const { channelId } = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.hasLoadedUserList = true
    channel.loadingUserList = true
  },

  ['@chat/retrieveUserList'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    const { channelId } = action.meta
    const userList = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    const { users } = channel
    const offlineArray = userList.filter(u => !users.active.has(u.id) && !users.idle.has(u.id))

    channel.loadingUserList = false
    channel.users.offline = new Set(offlineArray.map(u => u.id))
  },

  ['@chat/getChatUserProfile'](state, action) {
    const { userId, channelId, profile } = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    if (profile) {
      channel.userProfiles.set(userId, profile)
    }
  },

  ['@chat/activateChannel'](state, action) {
    const { channelId } = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.hasUnread = false
    channel.activated = true
  },

  ['@chat/deactivateChannel'](state, action) {
    const { channelId } = action.payload

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    const hasHistory = state.byId.get(channelId)!.messages.length > INACTIVE_CHANNEL_MAX_HISTORY

    channel.messages = channel.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    channel.hasHistory = channel.hasHistory || hasHistory
    channel.activated = false
  },

  ['@chat/permissionsChanged'](state, action) {
    const { channelId } = action.meta

    const channel = state.byId.get(channelId)
    if (!channel) {
      return
    }

    channel.selfPermissions = action.payload.selfPermissions
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return DEFAULT_CHAT_STATE
  },
})
