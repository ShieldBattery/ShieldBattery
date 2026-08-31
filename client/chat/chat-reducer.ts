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

// How many client-only messages (join/leave banners and the like) a channel keeps waiting for a
// loaded window that covers their time, once the window they were loaded in has been dropped or
// replaced. These messages exist nowhere but this session's memory, so this bounds how much of a
// long session's history of channel detours it can carry rather than dropping any of it.
const MAX_CARRIED_CLIENT_MESSAGES = 50

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
  loadingNewer: boolean
  /**
   * Whether messages newer than the loaded window exist on the server, i.e. the window is detached
   * from the present. While this is set, live messages are not appended (they belong on the far
   * side of the gap), and the window is never trimmed.
   */
  hasNewer: boolean
  /**
   * The newest server-recorded time (epoch ms) of a message that arrived live while the window was
   * detached and so was not appended to it. The window has caught back up to the present only once
   * it has loaded at least this far, which closes the race where a message arrives between the
   * server running the last page's query and this client applying its response.
   */
  detachedNewestTime?: number
  /**
   * Counts how many times the loaded window has been replaced or dropped. Every history request
   * carries the generation it was issued for, and the reducer discards responses that no longer
   * match, since a page has no boundary in common with a window it wasn't fetched for.
   */
  windowGen: number
  /**
   * Client-only messages (join/leave banners and the like) that were in a window dropped or
   * replaced wholesale, held here until a loaded window's covered time range reaches where they
   * happened, at which point they're spliced back into `messages`. These messages are never
   * persisted anywhere but this session's memory, so this is the only thing standing between a
   * window drop and losing them for good.
   */
  carriedClientMessages: ChatMessage[]
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
 * Returns the time (epoch ms) of the newest message in `messages` that carries a server-recorded
 * timestamp, or `undefined` if there is none. Client-only messages (join/leave banners and the
 * like) are stamped with the local clock, so their times can't be compared against or handed back
 * to the server.
 */
export function newestServerOriginTime(messages: readonly ChatMessage[]): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isServerOriginMessage(messages[i])) {
      return messages[i].time
    }
  }

  return undefined
}

/**
 * Returns the time (epoch ms) of the oldest message in `messages` that carries a server-recorded
 * timestamp, or `undefined` if there is none. See `newestServerOriginTime` for why client-only
 * messages are excluded: a window can open with one at its head (the self-join banner, or all
 * that's left after a drop leaves only carried messages behind), and such a message's local-clock
 * time is meaningless as a server request cursor or a window boundary.
 */
export function oldestServerOriginTime(messages: readonly ChatMessage[]): number | undefined {
  for (const message of messages) {
    if (isServerOriginMessage(message)) {
      return message.time
    }
  }

  return undefined
}

/**
 * Returns `incoming` with every message already present in `existing` removed. The history
 * endpoints seek by millisecond-precision time, so a page boundary landing inside a group of
 * messages that share a timestamp can hand back messages the window already holds.
 */
function dedupeAgainst(incoming: ChatMessage[], existing: readonly ChatMessage[]): ChatMessage[] {
  if (!existing.length) {
    return incoming
  }

  const existingIds = new Set(existing.map(m => m.id))
  return incoming.filter(m => !existingIds.has(m.id))
}

/**
 * Records that a message the user hasn't seen has arrived in a channel: raises the unread flag and,
 * where applicable, freezes the unread divider. Kept separate from `updateMessages` because a
 * message arriving while the loaded window is detached from the present isn't added to the window
 * at all, yet counts as unread exactly the same.
 */
function markChannelUnread(state: ChatState, channelId: SbChannelId) {
  const isChannelActivated = state.activatedChannels.has(channelId)

  if (!state.unreadChannels.has(channelId) && !isChannelActivated) {
    state.unreadChannels.add(channelId)
  }

  // The channel is being actively viewed, but the message still won't be seen right away: either
  // the view is scrolled up, or the loaded window sits behind the present, where the bottom of the
  // list isn't the newest message. Freeze the unread divider at the read position so it marks where
  // the user left off instead of chasing the read position as the eager mark-read keeps advancing
  // it.
  const isDetached = state.idToMessages.get(channelId)?.hasNewer ?? false
  if (
    isChannelActivated &&
    (!state.atBottomChannels.has(channelId) || isDetached) &&
    !state.idToUnreadLineTime.has(channelId)
  ) {
    const lastReadTime = state.idToLastReadTime.get(channelId)
    if (lastReadTime !== undefined) {
      state.idToUnreadLineTime.set(channelId, lastReadTime)
    }
  }
}

/**
 * Moves every client-only message out of `channelMessages.messages` and into its carry list, ahead
 * of the window being dropped or replaced wholesale. Unlike a server message, a client-only message
 * (a join/leave banner and the like) can never be re-fetched, so losing the window it was loaded in
 * would otherwise erase it for good; `mergeCarriedMessages` is what eventually gives it back a home.
 * Idempotent against a message already carried from an earlier drop (deduped by id), and caps the
 * list at `MAX_CARRIED_CLIENT_MESSAGES`, evicting the oldest by time.
 */
function carryClientMessages(channelMessages: MessagesState) {
  const carriedIds = new Set(channelMessages.carriedClientMessages.map(m => m.id))
  for (const message of channelMessages.messages) {
    if (!isServerOriginMessage(message) && !carriedIds.has(message.id)) {
      channelMessages.carriedClientMessages.push(message)
      carriedIds.add(message.id)
    }
  }

  if (channelMessages.carriedClientMessages.length > MAX_CARRIED_CLIENT_MESSAGES) {
    channelMessages.carriedClientMessages.sort((a, b) => a.time - b.time)
    channelMessages.carriedClientMessages = channelMessages.carriedClientMessages.slice(
      -MAX_CARRIED_CLIENT_MESSAGES,
    )
  }
}

/**
 * Splices carried client-only messages (see `carryClientMessages`) back into the loaded window
 * wherever the window now covers the moment they happened, removing them from the carry list so a
 * later call can't merge the same message twice. Must run after anything that changes what time
 * range the window covers — a fetched page or a reattach — since that's the only way a carried
 * message's moment can come back into view.
 *
 * The covered range runs from the oldest server-origin message's time to the newest, extended to
 * unbounded-older when `hasHistory` is false (nothing precedes what's loaded) and to
 * unbounded-newer when `hasNewer` is false (the window is attached to the present, so it covers
 * everything from here on, same as a live message keeps appending to it). A bound whose flag says
 * it's *not* unbounded but which has no server-origin message to anchor to (an empty or
 * all-client-only window) covers nothing on that side.
 */
function mergeCarriedMessages(channelMessages: MessagesState) {
  if (!channelMessages.carriedClientMessages.length) {
    return
  }

  const lowerBound = channelMessages.hasHistory
    ? (oldestServerOriginTime(channelMessages.messages) ?? Infinity)
    : -Infinity
  const upperBound = channelMessages.hasNewer
    ? (newestServerOriginTime(channelMessages.messages) ?? -Infinity)
    : Infinity

  const stillCarried: ChatMessage[] = []
  const reclaimed: ChatMessage[] = []
  for (const message of channelMessages.carriedClientMessages) {
    if (message.time >= lowerBound && message.time <= upperBound) {
      reclaimed.push(message)
    } else {
      stillCarried.push(message)
    }
  }

  if (!reclaimed.length) {
    return
  }

  channelMessages.carriedClientMessages = stillCarried
  channelMessages.messages = channelMessages.messages
    .concat(reclaimed)
    .sort((a, b) => a.time - b.time)
}

/**
 * Discards everything loaded for a channel, returning it to the shape a freshly-joined channel has:
 * nothing loaded, older history assumed to exist, attached to the present. Advancing the generation
 * makes the reducer discard any page still in flight for the window that was just dropped.
 */
function dropMessageWindow(channelMessages: MessagesState) {
  carryClientMessages(channelMessages)
  channelMessages.messages = []
  channelMessages.hasHistory = true
  channelMessages.hasNewer = false
  channelMessages.detachedNewestTime = undefined
  // In-flight requests for the dropped window will be discarded by the generation check when they
  // land, so their loading flags have to be lowered here or they'd stay raised forever.
  channelMessages.loadingHistory = false
  channelMessages.loadingNewer = false
  channelMessages.windowGen += 1
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

  // Trimming is safe when nobody is reading scrollback: either the channel isn't being viewed, or
  // the viewer is pinned to the bottom, where auto-scroll makes removing top messages invisible. A
  // detached window is never trimmed: the user is paging through it in both directions, and there's
  // no scroll compensation for messages disappearing off its top.
  const canTrim =
    !channelMessages.hasNewer && (!isChannelActivated || state.atBottomChannels.has(channelId))

  let sliced = false
  if (canTrim && channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY) {
    channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
    sliced = true
  }

  if (makeUnread) {
    markChannelUnread(state, channelId)
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
    loadingNewer: false,
    hasNewer: false,
    detachedNewestTime: undefined,
    windowGen: 0,
    carriedClientMessages: [],
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

    const channelMessages = state.idToMessages.get(channelId)
    if (channelMessages?.hasNewer) {
      // The loaded window sits behind the present, so this message belongs past the gap at its far
      // end rather than at the end of what's loaded. Remembering how far the present has run ahead
      // is what lets the window tell, once it has paged forward, that it has actually caught up.
      channelMessages.detachedNewestTime = Math.max(
        channelMessages.detachedNewestTime ?? -Infinity,
        newMessage.time,
      )
      markChannelUnread(state, channelId)
    } else {
      updateMessages(state, channelId, true, m => {
        m.push(newMessage)
        return m
      })
    }

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
    const { channelId, windowGen } = action.meta

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages || channelMessages.windowGen !== windowGen) {
      return
    }

    channelMessages.loadingHistory = false

    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    // Even though the payload here is `ServerChatMessage`, we expand its type so it can be
    // concatenated with the existing messages which could also contain client chat messages.
    const newMessages = action.payload.messages as ChatMessage[]

    channelMessages.hasHistory = action.payload.hasMoreBefore

    updateMessages(state, channelId, false, messages =>
      dedupeAgainst(newMessages, messages).concat(messages),
    )
    // The older edge just moved (or, for a window left holding only carried messages by a prior
    // drop, was established for the first time), so re-check whether it now reaches any of them.
    mergeCarriedMessages(channelMessages)
    updateChannelInfos(state, action.payload.channelMentions)
    updateDeletedChannels(state, action.payload.deletedChannels)
  },

  ['@chat/loadNewerMessagesBegin'](state, action) {
    const { channelId } = action.payload

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    channelMessages.loadingNewer = true
  },

  ['@chat/loadNewerMessages'](state, action) {
    const { channelId, windowGen } = action.meta

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages || channelMessages.windowGen !== windowGen) {
      return
    }

    channelMessages.loadingNewer = false

    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    const newMessages = action.payload.messages as ChatMessage[]

    updateMessages(state, channelId, false, messages =>
      messages.concat(dedupeAgainst(newMessages, messages)),
    )
    updateChannelInfos(state, action.payload.channelMentions)
    updateDeletedChannels(state, action.payload.deletedChannels)

    // Rejoining the present takes both the server saying nothing is newer and the window having
    // reached everything that arrived live while it was detached. A message sent between the server
    // running this page's query and this response landing leaves the window one page short, so
    // `hasNewer` stays set and the list's next-edge sentinel asks again until it converges. The
    // exception is a request issued when this client already knew of the messages it's waiting on:
    // live messages are only announced after they're stored, so such a request's query ran late
    // enough to see them, and them being absent from the response means they've since been deleted.
    // Attaching then (rather than holding out for a time no remaining message will ever reach)
    // keeps a deletion from turning the sentinel's retries into an endless loop.
    if (!action.payload.hasMoreAfter) {
      const newestLoadedTime = newestServerOriginTime(channelMessages.messages)
      const { detachedNewestTime } = channelMessages
      if (
        detachedNewestTime === undefined ||
        (newestLoadedTime !== undefined && newestLoadedTime >= detachedNewestTime) ||
        detachedNewestTime <= action.meta.knownNewestTime
      ) {
        channelMessages.hasNewer = false
        channelMessages.detachedNewestTime = undefined
      }
    }

    // The newer edge just moved, and reattaching extends coverage all the way to the present, so
    // re-check whether the window now reaches any carried message.
    mergeCarriedMessages(channelMessages)
  },

  ['@chat/loadMessagesAroundBegin'](state, action) {
    const { channelId } = action.payload

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    // The whole window is about to be replaced, so there's no one edge the wait belongs to; the
    // older edge's affordance stands in for both.
    channelMessages.loadingHistory = true
  },

  ['@chat/loadMessagesAround'](state, action) {
    const { channelId, windowGen } = action.meta

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages || channelMessages.windowGen !== windowGen) {
      return
    }

    channelMessages.loadingHistory = false
    channelMessages.loadingNewer = false

    if (action.error) {
      // TODO(2Pac): Handle errors
      return
    }

    // Everything this client knows the present ran at least as far as: the newest message it had
    // loaded (live messages keep appending to an attached window while the request is in flight)
    // and the newest it observed while detached. The replacement window has caught up to the
    // present only if it reaches this far.
    const knownNewest = Math.max(
      newestServerOriginTime(channelMessages.messages) ?? -Infinity,
      channelMessages.detachedNewestTime ?? -Infinity,
    )

    // The fetched range doesn't have to touch what was loaded, so there may be no seam to splice
    // them together at and the window is replaced outright. A client-only message can't be
    // refetched at the new range even if it belongs there, so it's carried instead of discarded;
    // `mergeCarriedMessages` below gives it back a home if the replacement window covers it.
    carryClientMessages(channelMessages)
    channelMessages.messages = action.payload.messages as ChatMessage[]
    channelMessages.hasHistory = action.payload.hasMoreBefore
    channelMessages.windowGen += 1

    if (action.payload.hasMoreAfter) {
      channelMessages.hasNewer = true
      channelMessages.detachedNewestTime = knownNewest === -Infinity ? undefined : knownNewest
    } else {
      // The server saw nothing newer than the replacement window, but a message that arrived
      // between its query running and this response landing exists only past the window's newer
      // edge, so the window must stay detached and page forward to it. A message this client
      // already knew of when the request was issued is the exception: the query ran late enough to
      // have seen it, so its absence means it's been deleted (see the matching reasoning where
      // newer pages land).
      const newestLoadedTime = newestServerOriginTime(channelMessages.messages) ?? -Infinity
      const knownNewestAtDispatch = action.meta.knownNewestTime ?? -Infinity
      if (newestLoadedTime < knownNewest && knownNewest > knownNewestAtDispatch) {
        channelMessages.hasNewer = true
        channelMessages.detachedNewestTime = knownNewest
      } else {
        channelMessages.hasNewer = false
        channelMessages.detachedNewestTime = undefined
      }
    }

    // The window's coverage was just established from scratch, so check it against everything
    // still carried rather than just what changed.
    mergeCarriedMessages(channelMessages)

    updateChannelInfos(state, action.payload.channelMentions)
    updateDeletedChannels(state, action.payload.deletedChannels)
  },

  ['@chat/resetMessageWindow'](state, action) {
    const { channelId } = action.payload

    const channelMessages = state.idToMessages.get(channelId)
    if (!channelMessages) {
      return
    }

    dropMessageWindow(channelMessages)
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
    const { channelId, atBottom } = action.payload

    // Freeze the unread divider at the read position before clearing the unread flag, so the
    // divider marks where the user left off instead of where the read position ends up after the
    // eager mark-read opening at the newest messages triggers.
    if (
      state.unreadChannels.has(channelId) &&
      !state.idToUnreadLineTime.has(channelId) &&
      state.idToLastReadTime.has(channelId)
    ) {
      state.idToUnreadLineTime.set(channelId, state.idToLastReadTime.get(channelId)!)
    }

    // A divider the read position has already moved past outlives that only for as long as the
    // view keeps returning to where the user stopped reading; opening at the newest messages means
    // they're caught up and the divider has served its purpose.
    if (atBottom) {
      const unreadLineTime = state.idToUnreadLineTime.get(channelId)
      const lastReadTime = state.idToLastReadTime.get(channelId)
      if (
        unreadLineTime !== undefined &&
        lastReadTime !== undefined &&
        lastReadTime > unreadLineTime
      ) {
        state.idToUnreadLineTime.delete(channelId)
      }
    }

    state.unreadChannels.delete(channelId)
    state.activatedChannels.add(channelId)
    if (atBottom) {
      state.atBottomChannels.add(channelId)
    } else {
      state.atBottomChannels.delete(channelId)
    }
  },

  ['@chat/deactivateChannel'](state, action) {
    const { channelId } = action.payload

    // The unread divider is only consumed once the read position has actually moved past it *and*
    // the user was looking at the newest messages when they left. A deactivation where they never
    // read anything new (including the mount/cleanup/remount cycle React's StrictMode runs in
    // development) leaves the still-unread divider in place, and so does one from the middle of the
    // backlog, where the read position running ahead is an artifact of having passed the bottom on
    // the way in rather than of having caught up.
    const unreadLineTime = state.idToUnreadLineTime.get(channelId)
    const lastReadTime = state.idToLastReadTime.get(channelId)
    if (
      state.atBottomChannels.has(channelId) &&
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

    if (channelMessages.hasNewer) {
      // Keeping a window that sits mid-history would put the user back where they were reading with
      // no indication that the channel has run on past it, so a detached window is dropped whole
      // and the next visit starts from the present like any other fresh open.
      dropMessageWindow(channelMessages)
    } else {
      const hasHistory = channelMessages.messages.length > INACTIVE_CHANNEL_MAX_HISTORY

      channelMessages.messages = channelMessages.messages.slice(-INACTIVE_CHANNEL_MAX_HISTORY)
      channelMessages.hasHistory = channelMessages.hasHistory || hasHistory
    }

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
      const newestKnownTime = messages ? newestServerOriginTime(messages) : undefined
      if (newestKnownTime === undefined || newestKnownTime <= effective) {
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
      // drop it now, where the removal is invisible. For a detached window the bottom is only the
      // end of what's loaded rather than the newest message, and the user is still paging through
      // it, so nothing is dropped there.
      const channelMessages = state.idToMessages.get(channelId)
      if (channelMessages && !channelMessages.hasNewer) {
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

  ['@whispers/loadNewerMessages'](state, action) {
    if (!action.error) {
      updateChannelInfos(state, action.payload.channelMentions)
      updateDeletedChannels(state, action.payload.deletedChannels)
    }
  },

  ['@whispers/loadMessagesAround'](state, action) {
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
