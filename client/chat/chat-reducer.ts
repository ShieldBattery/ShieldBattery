import { Immutable } from 'immer'
import { nanoid } from 'nanoid'
import {
  BasicChannelInfo,
  ChannelModerationAction,
  ChannelPermissions,
  ChannelPreferences,
  ChatMessage,
  ChatUserProfileJson,
  ClientChatMessageType,
  DetailedChannelInfo,
  InitialChannelData,
  JoinedChannelInfo,
  SbChannelId,
} from '../../common/chat'
import { SbUserId } from '../../common/users/sb-user-id'
import { isServerOriginMessage } from '../messaging/message-records'
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
  /** A map of channel ID -> your own preferences for this chat channel */
  idToSelfPreferences: Map<SbChannelId, ChannelPreferences>
  /** A map of channel ID -> your own permissions for this chat channel */
  idToSelfPermissions: Map<SbChannelId, ChannelPermissions>
  /** A set of joined chat channels that are activated */
  activatedChannels: Set<SbChannelId>
  /** A set of joined chat channels whose message list is scrolled to the bottom */
  atBottomChannels: Set<SbChannelId>
  /** A set of joined chat channels that are unread */
  unreadChannels: Set<SbChannelId>
  /** A set of channel IDs saved in various chat messages that no longer exist. */
  deletedChannels: Set<SbChannelId>
  /**
   * A map of channel ID -> the client's view of the server-recorded read position (epoch ms).
   * Seeded from the server at init, and advanced optimistically whenever the client reports a
   * mark-read for the channel.
   */
  idToLastReadTime: Map<SbChannelId, number>
  /**
   * A map of channel ID -> the newest known time (epoch ms) of a server message from another,
   * non-blocked user that mentions the current user. Compared against `idToLastReadTime` (via
   * `channelHasUnreadMention`) to derive whether the channel has an unread mention; there is no
   * separate boolean flag or clear logic for this, since the read position advancing past it is
   * exactly what "read" means here.
   */
  idToLatestMentionTime: Map<SbChannelId, number>
  /**
   * A map of channel ID -> the frozen position of the unread divider for the current activation.
   * Captured when an unread channel activates, or when a message arrives while the channel is
   * activated and scrolled up, and held until deactivation so the divider doesn't chase
   * `idToLastReadTime` as it keeps advancing underneath it.
   */
  idToUnreadLineTime: Map<SbChannelId, number>
}

const DEFAULT_CHAT_STATE: Immutable<ChatState> = {
  joinedChannels: new Set(),
  idToBasicInfo: new Map(),
  idToDetailedInfo: new Map(),
  idToJoinedInfo: new Map(),
  idToUsers: new Map(),
  idToMessages: new Map(),
  idToUserProfiles: new Map(),
  idToSelfPreferences: new Map(),
  idToSelfPermissions: new Map(),
  activatedChannels: new Set(),
  atBottomChannels: new Set(),
  unreadChannels: new Set(),
  deletedChannels: new Set(),
  idToLastReadTime: new Map(),
  idToLatestMentionTime: new Map(),
  idToUnreadLineTime: new Map(),
}

/**
 * Returns whether `channelId` has an unread message that mentions the current user. The server
 * always sends a read marker for a joined channel (falling back to one millisecond before the
 * member's join date when none has been recorded), so a joined channel with mention state should
 * always have an `idToLastReadTime` entry; if one is somehow missing, `?? Infinity` fails toward
 * "everything is read" rather than flipping the badge to urgent with nothing to compare the
 * mention time against.
 */
export function channelHasUnreadMention(
  chatState: Immutable<ChatState>,
  channelId: SbChannelId,
): boolean {
  if (chatState.activatedChannels.has(channelId)) {
    return false
  }

  const latestMentionTime = chatState.idToLatestMentionTime.get(channelId)
  if (latestMentionTime === undefined) {
    return false
  }

  return latestMentionTime > (chatState.idToLastReadTime.get(channelId) ?? Infinity)
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
  const detailedChannelInfo = state.idToDetailedInfo.get(channelId)
  if (!joinedChannelInfo || !channelUsers || !channelUserProfiles || !detailedChannelInfo) {
    return
  }

  channelUsers.active.delete(userId)
  channelUsers.idle.delete(userId)
  channelUsers.offline.delete(userId)
  channelUserProfiles.delete(userId)
  detailedChannelInfo.userCount -= 1

  let messageType:
    | ClientChatMessageType.LeaveChannel
    | ClientChatMessageType.KickUser
    | ClientChatMessageType.BanUser = ClientChatMessageType.LeaveChannel
  if (reason === ChannelModerationAction.Kick) {
    messageType = ClientChatMessageType.KickUser
  } else if (reason === ChannelModerationAction.Ban) {
    messageType = ClientChatMessageType.BanUser
  }

  updateMessages(state, channelId, true, m => {
    m.push({
      id: nanoid(),
      type: messageType,
      channelId,
      time: Date.now(),
      userId,
    })
    return m
  })

  if (newOwnerId) {
    setChannelOwner(state, channelId, newOwnerId)
  }
}

function setChannelOwner(state: ChatState, channelId: SbChannelId, newOwnerId: SbUserId) {
  const joinedChannelInfo = state.idToJoinedInfo.get(channelId)
  if (!joinedChannelInfo) {
    return
  }

  joinedChannelInfo.ownerId = newOwnerId

  updateMessages(state, channelId, true, m => {
    m.push({
      id: nanoid(),
      type: ClientChatMessageType.NewChannelOwner,
      channelId,
      time: Date.now(),
      newOwnerId,
    })
    return m
  })
}

function removeSelfFromChannel(state: ChatState, channelId: SbChannelId) {
  state.joinedChannels.delete(channelId)
  state.idToJoinedInfo.delete(channelId)
  state.idToUsers.delete(channelId)
  state.idToMessages.delete(channelId)
  state.idToUserProfiles.delete(channelId)
  state.idToSelfPreferences.delete(channelId)
  state.idToSelfPermissions.delete(channelId)
  state.activatedChannels.delete(channelId)
  state.atBottomChannels.delete(channelId)
  state.unreadChannels.delete(channelId)
  state.idToLastReadTime.delete(channelId)
  state.idToLatestMentionTime.delete(channelId)
  state.idToUnreadLineTime.delete(channelId)
}

/**
 * Update the messages field for a channel, keeping the `hasUnread` flag in proper sync.
 *
 * @param state The complete chat state which holds all of the channels.
 * @param channelId The ID of the channel in which to update the messages.
 * @param makeUnread A boolean flag indicating whether to mark a channel as having unread messages.
 * @param updateFn A function which performs the update operation on the messages field. It may
 *   mutate the passed-in array in place (e.g. via `push`) and must return the array to use as the
 *   new messages value.
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

  // Trimming is safe when nobody is reading scrollback: either the channel isn't being viewed, or
  // the viewer is pinned to the bottom, where auto-scroll makes removing top messages invisible.
  const canTrim = !isChannelActivated || state.atBottomChannels.has(channelId)

  let sliced = false
  if (canTrim && channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY) {
    channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    sliced = true
  }

  if (makeUnread && !isChannelUnread && !isChannelActivated) {
    state.unreadChannels.add(channelId)
  }

  // The channel is being actively viewed but scrolled up, so a new message won't be seen right
  // away. Freeze the unread divider at the read position so it marks where the user left off
  // instead of chasing the read position as the eager mark-read keeps advancing it.
  if (
    makeUnread &&
    isChannelActivated &&
    !state.atBottomChannels.has(channelId) &&
    !state.idToUnreadLineTime.has(channelId)
  ) {
    const lastReadTime = state.idToLastReadTime.get(channelId)
    if (lastReadTime !== undefined) {
      state.idToUnreadLineTime.set(channelId, lastReadTime)
    }
  }

  channelMessages.hasHistory = channelMessages.hasHistory || sliced
}

function updateChannelInfos(
  state: ChatState,
  basicChannelInfos: BasicChannelInfo[],
  detailedChannelInfos: DetailedChannelInfo[] = [],
  joinedChannelInfos: JoinedChannelInfo[] = [],
) {
  for (const channel of basicChannelInfos) {
    state.idToBasicInfo.set(channel.id, channel)
    state.deletedChannels.delete(channel.id)
  }
  for (const channel of detailedChannelInfos) {
    state.idToDetailedInfo.set(channel.id, channel)
  }
  for (const channel of joinedChannelInfos) {
    state.idToJoinedInfo.set(channel.id, channel)
  }
}

function updateDeletedChannels(state: ChatState, deletedChannels: SbChannelId[]) {
  for (const channelId of deletedChannels) {
    state.deletedChannels.add(channelId)
  }
}

function initChannelUsers(state: ChatState, channelId: SbChannelId, activeUserIds?: SbUserId[]) {
  const channelUsers = state.idToUsers.get(channelId)
  if (channelUsers) {
    if (activeUserIds) {
      channelUsers.active = new Set(activeUserIds)
    }
  } else {
    state.idToUsers.set(channelId, {
      active: new Set(activeUserIds),
      idle: new Set(),
      offline: new Set(),
      hasLoadedUserList: false,
      loadingUserList: false,
    })
  }
}

function initChannel(state: ChatState, channelId: SbChannelId, data: InitialChannelData) {
  const {
    channelInfo,
    detailedChannelInfo,
    joinedChannelInfo,
    selfPreferences,
    selfPermissions,
    hasUnread,
    lastReadTime,
    latestMentionTime,
  } = data

  const messagesState: MessagesState = {
    messages: [],
    loadingHistory: false,
    hasHistory: true,
  }
  state.joinedChannels.add(channelId)
  state.idToBasicInfo.set(channelId, channelInfo)
  state.idToDetailedInfo.set(channelId, detailedChannelInfo)
  state.idToJoinedInfo.set(channelId, joinedChannelInfo)
  initChannelUsers(state, channelId)
  state.idToMessages.set(channelId, messagesState)
  state.idToUserProfiles.set(channelId, new Map())
  state.idToSelfPreferences.set(channelId, selfPreferences)
  state.idToSelfPermissions.set(channelId, selfPermissions)

  if (lastReadTime !== undefined) {
    state.idToLastReadTime.set(channelId, lastReadTime)
  }

  if (latestMentionTime !== undefined) {
    const existing = state.idToLatestMentionTime.get(channelId)
    state.idToLatestMentionTime.set(
      channelId,
      existing === undefined ? latestMentionTime : Math.max(existing, latestMentionTime),
    )
  }

  // Seeds the unread badge from the server's recorded read position, so it survives a restart
  // instead of resetting to "read" until the next message arrives. A channel the user is currently
  // viewing is never marked unread, matching how a live message never marks an activated channel
  // unread either.
  if (hasUnread && !state.activatedChannels.has(channelId)) {
    state.unreadChannels.add(channelId)
  }

  updateMessages(state, channelId, false, m => {
    m.push({
      id: nanoid(),
      type: ClientChatMessageType.SelfJoinChannel,
      channelId,
      time: Date.now(),
    })
    return m
  })
}

export default immerKeyedReducer(DEFAULT_CHAT_STATE, {
  ['@chat/getJoinedChannels'](state, action) {
    for (const channel of action.payload) {
      initChannel(state, channel.channelInfo.id, channel)
    }
  },

  ['@chat/initChannel'](state, action) {
    initChannel(state, action.meta.channelId, action.payload)
  },

  ['@chat/initActiveUsers'](state, action) {
    const { activeUserIds } = action.payload
    const { channelId } = action.meta

    initChannelUsers(state, channelId, activeUserIds)
  },

  ['@chat/updateJoin'](state, action) {
    const { user, message } = action.payload
    const { channelId } = action.meta

    const channelUsers = state.idToUsers.get(channelId)
    const detailedChannelInfo = state.idToDetailedInfo.get(channelId)
    if (!channelUsers || !detailedChannelInfo) {
      return
    }

    channelUsers.active.add(user.id)
    detailedChannelInfo.userCount += 1

    updateMessages(state, channelId, true, m => {
      m.push(message)
      return m
    })
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

  ['@chat/ownerChanged'](state, action) {
    const { newOwnerId } = action.payload
    const { channelId } = action.meta

    setChannelOwner(state, channelId, newOwnerId)
  },

  ['@chat/updateMessage'](state, action) {
    const { message: newMessage, channelMentions } = action.payload
    const { channelId, mentionsSelf } = action.meta

    updateMessages(state, channelId, true, m => {
      m.push(newMessage)
      return m
    })
    updateChannelInfos(state, channelMentions)

    if (mentionsSelf) {
      const existing = state.idToLatestMentionTime.get(channelId)
      if (existing === undefined || newMessage.time > existing) {
        state.idToLatestMentionTime.set(channelId, newMessage.time)
      }
    }
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
      const channelMessages = state.idToMessages.get(action.meta.channelId)
      if (channelMessages) {
        channelMessages.loadingHistory = false
      }
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
    updateChannelInfos(state, action.payload.channelMentions)
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
    const { channelInfo, detailedChannelInfo, joinedChannelInfo } = action.payload

    updateChannelInfos(
      state,
      [channelInfo],
      detailedChannelInfo ? [detailedChannelInfo] : undefined,
      joinedChannelInfo ? [joinedChannelInfo] : undefined,
    )
  },

  ['@chat/getBatchChannelInfo'](state, action) {
    if (action.error) {
      return
    }

    const { channelInfos, detailedChannelInfos, joinedChannelInfos } = action.payload

    updateChannelInfos(state, channelInfos, detailedChannelInfos, joinedChannelInfos)
  },

  ['@chat/searchChannels'](state, action) {
    const { channelInfos, detailedChannelInfos, joinedChannelInfos } = action.payload

    updateChannelInfos(state, channelInfos, detailedChannelInfos, joinedChannelInfos)
  },

  ['@chat/activateChannel'](state, action) {
    const { channelId } = action.payload

    // Freeze the unread divider at the read position before clearing the unread flag, so the
    // divider marks where the user left off instead of where the read position ends up after the
    // eager mark-read this activation triggers.
    if (
      state.unreadChannels.has(channelId) &&
      !state.idToUnreadLineTime.has(channelId) &&
      state.idToLastReadTime.has(channelId)
    ) {
      state.idToUnreadLineTime.set(channelId, state.idToLastReadTime.get(channelId)!)
    }

    state.unreadChannels.delete(channelId)
    state.activatedChannels.add(channelId)
    // Message lists mount pinned to the bottom.
    state.atBottomChannels.add(channelId)
  },

  ['@chat/deactivateChannel'](state, action) {
    const { channelId } = action.payload

    // The unread divider is only consumed once the read position has actually moved past it — a
    // deactivation where the user never read anything new (including the mount/cleanup/remount
    // cycle React's StrictMode runs in development) leaves the still-unread divider in place for
    // the next visit.
    const unreadLineTime = state.idToUnreadLineTime.get(channelId)
    const lastReadTime = state.idToLastReadTime.get(channelId)
    if (
      unreadLineTime !== undefined &&
      lastReadTime !== undefined &&
      lastReadTime > unreadLineTime
    ) {
      state.idToUnreadLineTime.delete(channelId)
    }

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    const hasHistory = channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY

    channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    channelMessages.hasHistory = channelMessages.hasHistory || hasHistory
    state.activatedChannels.delete(channelId)
    state.atBottomChannels.delete(channelId)
  },

  // This arrives both from this session's own optimistic mark-read reports (dispatched only while
  // the channel is activated) and from the socket handler relaying a mark-read made in one of the
  // user's other sessions (which can arrive for a channel this session isn't currently viewing).
  // The unread flag and frozen divider are only re-evaluated in the latter case: an activated
  // channel already has its unread flag cleared, and its divider is re-evaluated by
  // `deactivateChannel` instead, so it must never move while the channel is being viewed here.
  ['@chat/updateLastReadTime'](state, action) {
    const { channelId, lastReadTime } = action.payload

    const existing = state.idToLastReadTime.get(channelId)
    if (existing === undefined || lastReadTime > existing) {
      state.idToLastReadTime.set(channelId, lastReadTime)
    }
    const effective = state.idToLastReadTime.get(channelId)!

    if (!state.activatedChannels.has(channelId)) {
      const messages = state.idToMessages.get(channelId)?.messages
      let newestServerOriginTime: number | undefined
      if (messages) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (isServerOriginMessage(messages[i])) {
            newestServerOriginTime = messages[i].time
            break
          }
        }
      }
      if (newestServerOriginTime === undefined || newestServerOriginTime <= effective) {
        state.unreadChannels.delete(channelId)
      }

      const unreadLineTime = state.idToUnreadLineTime.get(channelId)
      if (unreadLineTime !== undefined && effective > unreadLineTime) {
        state.idToUnreadLineTime.delete(channelId)
      }
    }
  },

  ['@chat/updateChannelAtBottom'](state, action) {
    const { channelId, atBottom } = action.payload

    const wasAtBottom = state.atBottomChannels.has(channelId)
    if (atBottom) {
      state.atBottomChannels.add(channelId)
    } else {
      state.atBottomChannels.delete(channelId)
    }

    if (atBottom && !wasAtBottom) {
      // The user returned to the bottom after reading scrollback that accumulated past the cap;
      // drop it now, where the removal is invisible.
      const channelMessages = state.idToMessages.get(channelId)
      if (channelMessages) {
        const hasHistory = channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY

        channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
        channelMessages.hasHistory = channelMessages.hasHistory || hasHistory
      }
    }
  },

  ['@chat/preferencesChanged'](state, action) {
    const { channelId } = action.meta

    state.idToSelfPreferences.set(channelId, action.payload.selfPreferences)
  },

  ['@chat/permissionsChanged'](state, action) {
    const { channelId } = action.meta

    state.idToSelfPermissions.set(channelId, action.payload.selfPermissions)
  },

  ['@chat/userProfileChanged'](state, action) {
    const { channelId } = action.meta
    const { userId, isModerator } = action.payload

    const channelUserProfiles = state.idToUserProfiles.get(channelId)
    if (!channelUserProfiles) {
      return
    }

    const existingProfile = channelUserProfiles.get(userId)
    if (existingProfile) {
      channelUserProfiles.set(userId, {
        ...existingProfile,
        isModerator,
      })
    }
  },

  ['@whispers/updateMessage'](state, action) {
    updateChannelInfos(state, action.payload.channelMentions)
  },

  ['@whispers/loadMessageHistory'](state, action) {
    if (!action.error) {
      updateChannelInfos(state, action.payload.channelMentions)
      updateDeletedChannels(state, action.payload.deletedChannels)
    }
  },

  ['@lobbies/updateChatMessage'](state, action) {
    updateChannelInfos(state, action.payload.channelMentions)
  },

  ['@messaging/loadMentions'](state, action) {
    const { channelMentions } = action.payload
    updateChannelInfos(state, channelMentions)
  },

  ['@network/connect']() {
    return DEFAULT_CHAT_STATE
  },
})
