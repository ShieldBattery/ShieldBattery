import cuid from 'cuid'
import { Immutable } from 'immer'
import {
  BasicChannelInfo,
  ChannelModerationAction,
  ChannelPermissions,
  ChatMessage,
  ChatUserProfileJson,
  ClientChatMessageType,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user'
import { LOBBY_UPDATE_CHAT_MESSAGE, NETWORK_SITE_CONNECTED } from '../actions'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

// How many messages should be kept for inactive channels
const INACTIVE_CHANNEL_MAX_HISTORY = 150

export interface UsersState {
  active: Set<SbUserId>
  idle: Set<SbUserId>
  offline: Set<SbUserId>

  hasLoadedUserList: boolean
  loadingUserList: boolean
}

export interface MessagesState {
  messages: ChatMessage[]

  loadingHistory: boolean
  hasHistory: boolean
}

export interface ChatState {
  /** A set of joined chat channels */
  joinedChannels: Set<SbChannelId>
  /** A map of channel ID -> basic channel info (used in channel mentions, etc.) */
  idToBasicInfo: Map<SbChannelId, BasicChannelInfo>
  /** A map of channel ID -> detailed channel info (used in channel info card, etc.) */
  idToDetailedInfo: Map<SbChannelId, DetailedChannelInfo>
  /** A map of channel ID -> joined channel info (used in user's joined channel page, etc.) */
  idToJoinedInfo: Map<SbChannelId, JoinedChannelInfo>
  /** A map of channel ID -> channel users */
  idToUsers: Map<SbChannelId, UsersState>
  /** A map of channel ID -> channel messages */
  idToMessages: Map<SbChannelId, MessagesState>
  /** A nested map of channel ID -> a map of user ID -> chat channel user profile */
  idToUserProfiles: Map<SbChannelId, Map<SbUserId, ChatUserProfileJson>>
  /** A map of channel ID -> your own permissions for this chat channel */
  idToSelfPermissions: Map<SbChannelId, ChannelPermissions>
  /** A set of joined chat channels that are activated */
  activatedChannels: Set<SbChannelId>
  /** A set of joined chat channels that are unread */
  unreadChannels: Set<SbChannelId>
  /** A set of channel IDs saved in various chat messages that no longer exist. */
  deletedChannels: Set<SbChannelId>
}

const DEFAULT_CHAT_STATE: Immutable<ChatState> = {
  joinedChannels: new Set(),
  idToBasicInfo: new Map(),
  idToDetailedInfo: new Map(),
  idToJoinedInfo: new Map(),
  idToUsers: new Map(),
  idToMessages: new Map(),
  idToUserProfiles: new Map(),
  idToSelfPermissions: new Map(),
  activatedChannels: new Set(),
  unreadChannels: new Set(),
  deletedChannels: new Set(),
}

function removeUserFromChannel(
  state: ChatState,
  channelId: SbChannelId,
  userId: SbUserId,
  newOwnerId?: SbUserId,
  reason?: ChannelModerationAction,
) {
  const joinedChannelInfo = state.idToJoinedInfo.get(channelId)
  const channelUsers = state.idToUsers.get(channelId)
  const channelUserProfiles = state.idToUserProfiles.get(channelId)
  if (!joinedChannelInfo || !channelUsers || !channelUserProfiles) {
    return
  }

  channelUsers.active.delete(userId)
  channelUsers.idle.delete(userId)
  channelUsers.offline.delete(userId)
  channelUserProfiles.delete(userId)

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
    joinedChannelInfo.ownerId = newOwnerId

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

function removeSelfFromChannel(state: ChatState, channelId: SbChannelId) {
  state.joinedChannels.delete(channelId)
  state.idToJoinedInfo.delete(channelId)
  state.idToUsers.delete(channelId)
  state.idToMessages.delete(channelId)
  state.idToUserProfiles.delete(channelId)
  state.idToSelfPermissions.delete(channelId)
  state.activatedChannels.delete(channelId)
  state.unreadChannels.delete(channelId)
}

/**
 * Update the messages field for a channel, keeping the `hasUnread` flag in proper sync.
 *
 * @param state The complete chat state which holds all of the channels.
 * @param channelId The ID of the channel in which to update the messages.
 * @param makeUnread A boolean flag indicating whether to mark a channel as having unread messages.
 * @param updateFn A function which should perform the update operation on the messages field. Note
 *   that this function should return a new array, instead of performing the update in-place.
 */
function updateMessages(
  state: ChatState,
  channelId: SbChannelId,
  makeUnread: boolean,
  updateFn: (messages: ChatMessage[]) => ChatMessage[],
) {
  const channelMessages = state.idToMessages.get(channelId)
  if (!channelMessages) {
    return
  }

  channelMessages.messages = updateFn(channelMessages.messages)

  const isChannelActivated = state.activatedChannels.has(channelId)
  const isChannelUnread = state.unreadChannels.has(channelId)

  let sliced = false
  if (!isChannelActivated && channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY) {
    channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    sliced = true
  }

  if (makeUnread && !isChannelUnread && !isChannelActivated) {
    state.unreadChannels.add(channelId)
  }

  channelMessages.hasHistory = channelMessages.hasHistory || sliced
}

function updateBasicChannelData(state: ChatState, channels: BasicChannelInfo[]) {
  for (const channel of channels) {
    state.idToBasicInfo.set(channel.id, channel)
    state.deletedChannels.delete(channel.id)
  }
}

function updateDeletedChannels(state: ChatState, deletedChannels: SbChannelId[]) {
  for (const channelId of deletedChannels) {
    state.deletedChannels.add(channelId)
  }
}

export default immerKeyedReducer(DEFAULT_CHAT_STATE, {
  ['@chat/initChannel'](state, action) {
    const { channelInfo, detailedChannelInfo, joinedChannelInfo, activeUserIds, selfPermissions } =
      action.payload
    const { channelId } = action.meta

    const channelUsers: UsersState = {
      active: new Set(activeUserIds),
      idle: new Set(),
      offline: new Set(),
      hasLoadedUserList: false,
      loadingUserList: false,
    }
    const messagesState: MessagesState = {
      messages: [],
      loadingHistory: false,
      hasHistory: true,
    }
    state.joinedChannels.add(channelId)
    state.idToBasicInfo.set(channelId, channelInfo)
    state.idToDetailedInfo.set(channelId, detailedChannelInfo)
    state.idToJoinedInfo.set(channelId, joinedChannelInfo)
    state.idToUsers.set(channelId, channelUsers)
    state.idToMessages.set(channelId, messagesState)
    state.idToUserProfiles.set(channelId, new Map())
    state.idToSelfPermissions.set(channelId, selfPermissions)

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

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    channelUsers.active.add(user.id)

    updateMessages(state, channelId, true, m => m.concat(message))
  },

  ['@chat/updateLeave'](state, action) {
    const { userId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, userId, newOwnerId)
  },

  ['@chat/updateLeaveSelf'](state, action) {
    const { channelId } = action.meta

    removeSelfFromChannel(state, channelId)
  },

  ['@chat/updateKick'](state, action) {
    const { targetId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, targetId, newOwnerId, ChannelModerationAction.Kick)
  },

  ['@chat/updateKickSelf'](state, action) {
    const { channelId } = action.meta

    removeSelfFromChannel(state, channelId)
  },

  ['@chat/updateBan'](state, action) {
    const { targetId, newOwnerId } = action.payload
    const { channelId } = action.meta

    removeUserFromChannel(state, channelId, targetId, newOwnerId, ChannelModerationAction.Ban)
  },

  ['@chat/updateBanSelf'](state, action) {
    const { channelId } = action.meta

    removeSelfFromChannel(state, channelId)
  },

  ['@chat/updateMessage'](state, action) {
    const { message: newMessage, channelMentions } = action.payload
    const { channelId } = action.meta

    updateMessages(state, channelId, true, m => m.concat(newMessage))
    updateBasicChannelData(state, channelMentions)
  },

  ['@chat/updateUserActive'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    channelUsers.active.add(userId)
    channelUsers.idle.delete(userId)
    channelUsers.offline.delete(userId)
  },

  ['@chat/updateUserIdle'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    channelUsers.idle.add(userId)
    channelUsers.active.delete(userId)
    channelUsers.offline.delete(userId)
  },

  ['@chat/updateUserOffline'](state, action) {
    const { userId } = action.payload
    const { channelId } = action.meta

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    channelUsers.offline.add(userId)
    channelUsers.active.delete(userId)
    channelUsers.idle.delete(userId)
  },

  ['@chat/loadMessageHistoryBegin'](state, action) {
    const { channelId } = action.payload

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    channelMessages.loadingHistory = true
  },

  ['@chat/loadMessageHistory'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    const { channelId, limit } = action.meta

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    // Even though the payload here is `ServerChatMessage`, we expand its type so it can be
    // concatenated with the existing messages which could also contain client chat messages.
    const newMessages = action.payload.messages as ChatMessage[]

    channelMessages.loadingHistory = false
    if (newMessages.length < limit) {
      channelMessages.hasHistory = false
    }

    updateMessages(state, channelId, false, messages => newMessages.concat(messages))
    updateBasicChannelData(state, action.payload.channelMentions)
    updateDeletedChannels(state, action.payload.deletedChannels)
  },

  ['@chat/updateMessageDeleted'](state, action) {
    const { channelId } = action.meta
    const { messageId } = action.payload

    updateMessages(state, channelId, false, messages => messages.filter(m => m.id !== messageId))
  },

  ['@chat/retrieveUserListBegin'](state, action) {
    const { channelId } = action.payload

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    channelUsers.hasLoadedUserList = true
    channelUsers.loadingUserList = true
  },

  ['@chat/retrieveUserList'](state, action) {
    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    const { channelId } = action.meta
    const userList = action.payload

    const channelUsers = state.idToUsers.get(channelId)
    if (!channelUsers) {
      return
    }

    const offlineArray = userList.filter(
      u => !channelUsers.active.has(u.id) && !channelUsers.idle.has(u.id),
    )

    channelUsers.loadingUserList = false
    channelUsers.offline = new Set(offlineArray.map(u => u.id))
  },

  ['@chat/getChatUserProfile'](state, action) {
    const { userId, channelId, profile } = action.payload

    const channelUserProfiles = state.idToUserProfiles.get(channelId)
    if (!channelUserProfiles) {
      return
    }

    if (profile) {
      channelUserProfiles.set(userId, profile)
    }
  },

  ['@chat/getChannelInfo'](state, action) {
    const { channelId } = action.meta
    const { channelInfo, detailedChannelInfo } = action.payload

    state.idToBasicInfo.set(channelId, channelInfo)
    if (detailedChannelInfo) {
      state.idToDetailedInfo.set(channelId, detailedChannelInfo)
    }
  },

  ['@chat/getBatchChannelInfo'](state, action) {
    if (action.error) {
      return
    }

    for (const channelInfo of action.payload.channelInfos) {
      state.idToBasicInfo.set(channelInfo.id, channelInfo)
    }
    for (const detailedChannelInfo of action.payload.detailedChannelInfos) {
      state.idToDetailedInfo.set(detailedChannelInfo.id, detailedChannelInfo)
    }
  },

  ['@chat/activateChannel'](state, action) {
    const { channelId } = action.payload

    state.unreadChannels.delete(channelId)
    state.activatedChannels.add(channelId)
  },

  ['@chat/deactivateChannel'](state, action) {
    const { channelId } = action.payload

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    const hasHistory = channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY

    channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    channelMessages.hasHistory = channelMessages.hasHistory || hasHistory
    state.activatedChannels.delete(channelId)
  },

  ['@chat/permissionsChanged'](state, action) {
    const { channelId } = action.meta

    state.idToSelfPermissions.set(channelId, action.payload.selfPermissions)
  },

  ['@whispers/updateMessage'](state, action) {
    updateBasicChannelData(state, action.payload.channelMentions)
  },

  ['@whispers/loadMessageHistory'](state, action) {
    updateBasicChannelData(state, action.payload.channelMentions)
    updateDeletedChannels(state, action.payload.deletedChannels)
  },

  ['@parties/updateChatMessage'](state, action) {
    updateBasicChannelData(state, action.payload.channelMentions)
  },

  [LOBBY_UPDATE_CHAT_MESSAGE as any](state: any, action: any) {
    updateBasicChannelData(state, action.payload.channelMentions)
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return DEFAULT_CHAT_STATE
  },
})
