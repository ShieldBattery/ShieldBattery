import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import {
  BasicChannelInfo,
  ChannelTextMessage,
  ChatMessage,
  ChatMessageEvent,
  ClientChatMessageType,
  GetChannelHistoryServerResponse,
  InitialChannelData,
  SbChannelId,
  SelfJoinChannelMessage,
  ServerChatMessage,
  ServerChatMessageType,
  makeSbChannelId,
} from '../../common/chat'
import { SbUser } from '../../common/users/sb-user'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ChatActions } from './actions'
import chatReducerImport, { ChatState, channelHasUnreadMention } from './chat-reducer'

// `immerKeyedReducer` accepts any action with a string `type`. These tests only ever feed it chat
// actions, so narrow the parameter to those, both for the extra checking and so that action objects
// can be written inline without tripping excess property checks.
const chatReducer = chatReducerImport as unknown as (
  state: Immutable<ChatState>,
  action: ChatActions,
) => Immutable<ChatState>

const CHANNEL_ID: SbChannelId = makeSbChannelId(1)
const USER_ID = makeSbUserId(2)

function textMessage(time: number): ChannelTextMessage {
  return {
    id: `text-${time}`,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time,
    from: USER_ID,
    text: 'hello',
  }
}

/** A client-only message: its `time` is stamped with the local clock, not the server's. */
function selfJoinMessage(time: number): SelfJoinChannelMessage {
  return {
    id: `join-${time}`,
    type: ClientChatMessageType.SelfJoinChannel,
    channelId: CHANNEL_ID,
    time,
  }
}

function makeState(
  overrides: {
    messages?: ChatMessage[]
    activated?: boolean
    atBottom?: boolean
    unread?: boolean
    lastReadTime?: number
    latestMentionTime?: number
    unreadLineTime?: number
    hasHistory?: boolean
    loadingHistory?: boolean
    loadingNewer?: boolean
    hasNewer?: boolean
    detachedNewestTime?: number
    windowGen?: number
  } = {},
): Immutable<ChatState> {
  const state: ChatState = {
    joinedChannels: new Set([CHANNEL_ID]),
    idToBasicInfo: new Map(),
    idToDetailedInfo: new Map(),
    idToJoinedInfo: new Map(),
    idToUsers: new Map(),
    idToMessages: new Map([
      [
        CHANNEL_ID,
        {
          messages: overrides.messages ?? [],
          loadingHistory: overrides.loadingHistory ?? false,
          hasHistory: overrides.hasHistory ?? true,
          loadingNewer: overrides.loadingNewer ?? false,
          hasNewer: overrides.hasNewer ?? false,
          detachedNewestTime: overrides.detachedNewestTime,
          windowGen: overrides.windowGen ?? 0,
        },
      ],
    ]),
    idToUserProfiles: new Map(),
    idToSelfPreferences: new Map(),
    idToSelfPermissions: new Map(),
    activatedChannels: new Set(overrides.activated ? [CHANNEL_ID] : []),
    atBottomChannels: new Set(overrides.atBottom ? [CHANNEL_ID] : []),
    unreadChannels: new Set(overrides.unread ? [CHANNEL_ID] : []),
    deletedChannels: new Set(),
    idToLastReadTime: new Map(
      overrides.lastReadTime !== undefined ? [[CHANNEL_ID, overrides.lastReadTime]] : [],
    ),
    idToLatestMentionTime: new Map(
      overrides.latestMentionTime !== undefined ? [[CHANNEL_ID, overrides.latestMentionTime]] : [],
    ),
    idToUnreadLineTime: new Map(
      overrides.unreadLineTime !== undefined ? [[CHANNEL_ID, overrides.unreadLineTime]] : [],
    ),
  }

  return state as Immutable<ChatState>
}

function updateLastReadTimeAction(lastReadTime: number): ChatActions {
  return {
    type: '@chat/updateLastReadTime',
    payload: { channelId: CHANNEL_ID, lastReadTime },
  }
}

const CHANNEL_BASIC_INFO: BasicChannelInfo = {
  id: CHANNEL_ID,
  name: 'test-channel',
  private: false,
  official: false,
}

const SENDER: SbUser = { id: USER_ID, name: 'sender', created: 0 }

function initialChannelData(overrides: { latestMentionTime?: number } = {}): InitialChannelData {
  return {
    channelInfo: CHANNEL_BASIC_INFO,
    detailedChannelInfo: { id: CHANNEL_ID, userCount: 1 },
    joinedChannelInfo: { id: CHANNEL_ID },
    selfPreferences: { hideBanner: false },
    selfPermissions: {
      kick: false,
      ban: false,
      changeTopic: false,
      togglePrivate: false,
      editPermissions: false,
    },
    latestMentionTime: overrides.latestMentionTime,
  }
}

function getJoinedChannelsAction(data: InitialChannelData): ChatActions {
  return {
    type: '@chat/getJoinedChannels',
    payload: [data],
  }
}

function updateMessageAction(time: number, mentionsSelf: boolean): ChatActions {
  const payload: ChatMessageEvent = {
    action: 'message2',
    message: textMessage(time),
    user: SENDER,
    mentions: [],
    channelMentions: [],
  }
  return {
    type: '@chat/updateMessage',
    payload,
    meta: { channelId: CHANNEL_ID, mentionsSelf },
  }
}

function updateLeaveSelfAction(): ChatActions {
  return {
    type: '@chat/updateLeaveSelf',
    meta: { channelId: CHANNEL_ID },
  }
}

const HISTORY_LIMIT = 50

function historyResponse(
  messages: ServerChatMessage[],
  {
    hasMoreBefore = true,
    hasMoreAfter = true,
  }: { hasMoreBefore?: boolean; hasMoreAfter?: boolean } = {},
): GetChannelHistoryServerResponse {
  return {
    messages,
    users: [],
    mentions: [],
    channelMentions: [],
    deletedChannels: [],
    hasMoreBefore,
    hasMoreAfter,
  }
}

function loadMessageHistoryAction(
  payload: GetChannelHistoryServerResponse,
  { windowGen = 0, beforeTime = -1 }: { windowGen?: number; beforeTime?: number } = {},
): ChatActions {
  return {
    type: '@chat/loadMessageHistory',
    payload,
    meta: { channelId: CHANNEL_ID, limit: HISTORY_LIMIT, beforeTime, windowGen },
  }
}

function loadNewerMessagesAction(
  payload: GetChannelHistoryServerResponse,
  {
    windowGen = 0,
    afterTime = 0,
    knownNewestTime = afterTime,
  }: { windowGen?: number; afterTime?: number; knownNewestTime?: number } = {},
): ChatActions {
  return {
    type: '@chat/loadNewerMessages',
    payload,
    meta: { channelId: CHANNEL_ID, limit: HISTORY_LIMIT, afterTime, windowGen, knownNewestTime },
  }
}

function loadMessagesAroundAction(
  payload: GetChannelHistoryServerResponse,
  {
    windowGen = 0,
    aroundTime = 0,
    knownNewestTime,
  }: { windowGen?: number; aroundTime?: number; knownNewestTime?: number } = {},
): ChatActions {
  return {
    type: '@chat/loadMessagesAround',
    payload,
    meta: { channelId: CHANNEL_ID, limit: HISTORY_LIMIT, aroundTime, windowGen, knownNewestTime },
  }
}

function resetMessageWindowAction(): ChatActions {
  return {
    type: '@chat/resetMessageWindow',
    payload: { channelId: CHANNEL_ID },
  }
}

function activateChannelAction(atBottom: boolean): ChatActions {
  return {
    type: '@chat/activateChannel',
    payload: { channelId: CHANNEL_ID, atBottom },
  }
}

function deactivateChannelAction(): ChatActions {
  return {
    type: '@chat/deactivateChannel',
    payload: { channelId: CHANNEL_ID },
  }
}

function windowOf(state: Immutable<ChatState>) {
  return state.idToMessages.get(CHANNEL_ID)!
}

function messageIdsOf(state: Immutable<ChatState>): string[] {
  return windowOf(state).messages.map(m => m.id)
}

/** Rewrites a request action into the rejected form the promise middleware dispatches. */
function asFailure(action: ChatActions): ChatActions {
  return {
    ...action,
    payload: new Error('request failed'),
    error: true,
  } as unknown as ChatActions
}

describe('client/chat/chat-reducer', () => {
  describe('@chat/updateLastReadTime', () => {
    test('does not regress the stored position when the incoming time is stale', () => {
      const state = makeState({ lastReadTime: 1000 })

      const result = chatReducer(state, updateLastReadTimeAction(500))

      expect(result.idToLastReadTime.get(CHANNEL_ID)).toBe(1000)
    })

    test('clears unread when no known server-origin message is newer than the incoming time', () => {
      const state = makeState({
        unread: true,
        lastReadTime: 100,
        messages: [textMessage(100)],
      })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(false)
    })

    test('keeps unread when a server-origin message is newer than the incoming time', () => {
      const state = makeState({
        unread: true,
        lastReadTime: 100,
        messages: [textMessage(300)],
      })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(true)
    })

    test('a client-local message newer than the incoming time does not keep unread', () => {
      const state = makeState({
        unread: true,
        lastReadTime: 100,
        messages: [textMessage(100), selfJoinMessage(999_999_999_999)],
      })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(false)
    })

    test('clears the frozen divider when it is behind the incoming time', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 150 })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.idToUnreadLineTime.has(CHANNEL_ID)).toBe(false)
    })

    test('keeps the frozen divider when it is at or ahead of the incoming time', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 250 })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(250)
    })

    test('leaves the unread flag and divider untouched for an activated channel', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 100,
        unreadLineTime: 150,
        messages: [textMessage(100)],
      })

      const result = chatReducer(state, updateLastReadTimeAction(200))

      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(true)
      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(150)
      // The read position itself still advances even while activated, since this is also the path
      // this session's own optimistic mark-read reports take.
      expect(result.idToLastReadTime.get(CHANNEL_ID)).toBe(200)
    })
  })

  describe('channelHasUnreadMention', () => {
    test('is false when there is no known mention time', () => {
      const state = makeState({ lastReadTime: 100 })

      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(false)
    })

    test('is false when there is no recorded read position, even with a mention time', () => {
      const state = makeState({ latestMentionTime: 100 })

      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(false)
    })

    test('is true when the mention time is newer than the read position', () => {
      const state = makeState({ lastReadTime: 100, latestMentionTime: 200 })

      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(true)
    })

    test('is false when the read position has caught up to the mention time', () => {
      const state = makeState({ lastReadTime: 200, latestMentionTime: 200 })

      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(false)
    })

    test('is false for an activated channel, even with an unread mention', () => {
      const state = makeState({ activated: true, lastReadTime: 100, latestMentionTime: 200 })

      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(false)
    })
  })

  describe('@chat/getJoinedChannels / @chat/initChannel', () => {
    test('seeds the mention time from the initial channel data', () => {
      const state = makeState()

      const result = chatReducer(
        state,
        getJoinedChannelsAction(initialChannelData({ latestMentionTime: 500 })),
      )

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(500)
    })

    test('does not regress an existing mention time when re-initialized with an older one', () => {
      const state = makeState({ latestMentionTime: 500 })

      const result = chatReducer(
        state,
        getJoinedChannelsAction(initialChannelData({ latestMentionTime: 300 })),
      )

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(500)
    })

    test('advances an existing mention time when re-initialized with a newer one', () => {
      const state = makeState({ latestMentionTime: 300 })

      const result = chatReducer(
        state,
        getJoinedChannelsAction(initialChannelData({ latestMentionTime: 500 })),
      )

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(500)
    })

    test('leaves the mention time unset when the initial data carries none', () => {
      const state = makeState()

      const result = chatReducer(state, getJoinedChannelsAction(initialChannelData()))

      expect(result.idToLatestMentionTime.has(CHANNEL_ID)).toBe(false)
    })
  })

  describe('@chat/updateMessage', () => {
    test('sets the mention time when the message mentions self', () => {
      const state = makeState()

      const result = chatReducer(state, updateMessageAction(100, true))

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(100)
    })

    test('does not set the mention time when the message does not mention self', () => {
      const state = makeState()

      const result = chatReducer(state, updateMessageAction(100, false))

      expect(result.idToLatestMentionTime.has(CHANNEL_ID)).toBe(false)
    })

    test('advances the mention time when a newer mention arrives', () => {
      const state = makeState({ latestMentionTime: 100 })

      const result = chatReducer(state, updateMessageAction(200, true))

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(200)
    })

    test('does not regress the mention time when an older mention arrives', () => {
      const state = makeState({ latestMentionTime: 200 })

      const result = chatReducer(state, updateMessageAction(100, true))

      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(200)
    })

    test('a read-time advance past the mention clears the derived unread-mention state', () => {
      let state = makeState({ lastReadTime: 50 })

      state = chatReducer(state, updateMessageAction(100, true))
      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(true)

      state = chatReducer(state, updateLastReadTimeAction(150))
      expect(channelHasUnreadMention(state, CHANNEL_ID)).toBe(false)
    })
  })

  describe('leaving a channel', () => {
    test('clears the mention time', () => {
      const state = makeState({ lastReadTime: 100, latestMentionTime: 200 })

      const result = chatReducer(state, updateLeaveSelfAction())

      expect(result.idToLatestMentionTime.has(CHANNEL_ID)).toBe(false)
    })
  })

  describe('@chat/loadMessageHistory', () => {
    test('takes the older edge straight from the response instead of inferring it', () => {
      const state = makeState()

      // A short page that nonetheless has more behind it: the count says nothing about the edge.
      const result = chatReducer(
        state,
        loadMessageHistoryAction(historyResponse([textMessage(100)], { hasMoreBefore: true })),
      )

      expect(windowOf(result).hasHistory).toBe(true)
      expect(windowOf(result).loadingHistory).toBe(false)
    })

    test('clears the older edge when the response says there is nothing more', () => {
      const state = makeState()

      const result = chatReducer(
        state,
        loadMessageHistoryAction(historyResponse([textMessage(100)], { hasMoreBefore: false })),
      )

      expect(windowOf(result).hasHistory).toBe(false)
    })

    test('drops messages the window already holds at the seam', () => {
      const state = makeState({ messages: [textMessage(100), textMessage(200)] })

      const result = chatReducer(
        state,
        loadMessageHistoryAction(historyResponse([textMessage(50), textMessage(100)])),
      )

      expect(messageIdsOf(result)).toEqual(['text-50', 'text-100', 'text-200'])
    })

    test('ignores a page fetched for a window that has since been replaced', () => {
      const state = makeState({ messages: [textMessage(200)], windowGen: 3 })

      const result = chatReducer(
        state,
        loadMessageHistoryAction(historyResponse([textMessage(100)], { hasMoreBefore: false }), {
          windowGen: 2,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-200'])
      expect(windowOf(result).hasHistory).toBe(true)
    })

    test('a failed page clears the loading flag without touching the window', () => {
      const state = makeState({ messages: [textMessage(200)], loadingHistory: true })

      const result = chatReducer(state, asFailure(loadMessageHistoryAction(historyResponse([]))))

      expect(windowOf(result).loadingHistory).toBe(false)
      expect(messageIdsOf(result)).toEqual(['text-200'])
      expect(windowOf(result).hasHistory).toBe(true)
    })
  })

  describe('@chat/loadMessagesAround', () => {
    test('replaces the window and detaches it from the present', () => {
      const state = makeState({
        messages: [textMessage(900), selfJoinMessage(950)],
        loadingHistory: true,
        loadingNewer: true,
      })

      const result = chatReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([textMessage(100), textMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: true,
          }),
          { aroundTime: 150 },
        ),
      )

      const window = windowOf(result)
      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(window.hasHistory).toBe(true)
      expect(window.hasNewer).toBe(true)
      expect(window.loadingHistory).toBe(false)
      expect(window.loadingNewer).toBe(false)
      expect(window.windowGen).toBe(1)
    })

    test('lands attached when the fetched window reaches the newest message', () => {
      const state = makeState({ hasNewer: true, detachedNewestTime: 500 })

      const result = chatReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([textMessage(400), textMessage(500)], {
            hasMoreBefore: false,
            hasMoreAfter: false,
          }),
        ),
      )

      expect(windowOf(result).hasNewer).toBe(false)
      expect(windowOf(result).hasHistory).toBe(false)
      expect(windowOf(result).detachedNewestTime).toBeUndefined()
    })

    test('stays detached when a message arrived while the request was in flight', () => {
      // The window held messages up to 500 when the request was dispatched (knownNewestTime), and
      // another message arrived at 600 before the response landed, so the replacement window ending
      // at 200 cannot have caught the present even though the server saw nothing newer.
      const state = makeState({ messages: [textMessage(500), textMessage(600)] })

      const result = chatReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([textMessage(100), textMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: false,
          }),
          { aroundTime: 150, knownNewestTime: 500 },
        ),
      )

      const window = windowOf(result)
      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(window.hasNewer).toBe(true)
      expect(window.detachedNewestTime).toBe(600)
    })

    test('lands attached when everything past the window was already known at dispatch', () => {
      // The newest loaded message (600) was known when the request was dispatched, so the server
      // not returning anything newer than 200 means the newer messages have been deleted.
      const state = makeState({ messages: [textMessage(500), textMessage(600)] })

      const result = chatReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([textMessage(100), textMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: false,
          }),
          { aroundTime: 150, knownNewestTime: 600 },
        ),
      )

      const window = windowOf(result)
      expect(window.hasNewer).toBe(false)
      expect(window.detachedNewestTime).toBeUndefined()
    })

    test('ignores a response fetched for a window that has since been replaced', () => {
      const state = makeState({ messages: [textMessage(900)], windowGen: 2 })

      const result = chatReducer(
        state,
        loadMessagesAroundAction(historyResponse([textMessage(100)]), { windowGen: 1 }),
      )

      expect(messageIdsOf(result)).toEqual(['text-900'])
      expect(windowOf(result).windowGen).toBe(2)
    })
  })

  describe('a detached message window', () => {
    test('does not append a live message, but records how far the present has run ahead', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = chatReducer(state, updateMessageAction(500, false))

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(windowOf(result).detachedNewestTime).toBe(500)
    })

    test('keeps the newest time when an older message arrives afterwards', () => {
      const state = makeState({ hasNewer: true, detachedNewestTime: 500 })

      const result = chatReducer(state, updateMessageAction(400, false))

      expect(windowOf(result).detachedNewestTime).toBe(500)
    })

    test('a live message still marks the channel unread and records a mention', () => {
      const state = makeState({ hasNewer: true })

      const result = chatReducer(state, updateMessageAction(500, true))

      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(true)
      expect(result.idToLatestMentionTime.get(CHANNEL_ID)).toBe(500)
    })

    test('a live message freezes the unread divider even at the bottom of the loaded window', () => {
      const state = makeState({
        hasNewer: true,
        activated: true,
        atBottom: true,
        lastReadTime: 100,
      })

      const result = chatReducer(state, updateMessageAction(500, false))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })

    test('an attached channel at the bottom does not freeze the divider', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 100 })

      const result = chatReducer(state, updateMessageAction(500, false))

      expect(result.idToUnreadLineTime.has(CHANNEL_ID)).toBe(false)
    })

    test('is never trimmed while it grows, even when the view is at the bottom of it', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({
        hasNewer: true,
        activated: true,
        atBottom: true,
        messages,
      })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(1000)]), { afterTime: 200 }),
      )

      expect(windowOf(result).messages.length).toBe(201)
    })

    test('is not trimmed when the view returns to the bottom of it', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ hasNewer: true, activated: true, messages })

      const result = chatReducer(state, {
        type: '@chat/updateChannelAtBottom',
        payload: { channelId: CHANNEL_ID, atBottom: true },
      })

      expect(windowOf(result).messages.length).toBe(200)
    })
  })

  describe('@chat/loadNewerMessages', () => {
    test('appends the page and reattaches once the server has nothing newer', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200)], { hasMoreAfter: false }), {
          afterTime: 100,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(windowOf(result).hasNewer).toBe(false)
      expect(windowOf(result).loadingNewer).toBe(false)
    })

    test('drops messages the window already holds at the seam', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100), textMessage(200)] })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200), textMessage(300)])),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200', 'text-300'])
    })

    test('stays detached while the server still has newer messages', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200)], { hasMoreAfter: true })),
      )

      expect(windowOf(result).hasNewer).toBe(true)
    })

    test('stays detached when a message arrived past the end of the final page', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200)], { hasMoreAfter: false })),
      )

      expect(windowOf(result).hasNewer).toBe(true)
      expect(windowOf(result).detachedNewestTime).toBe(300)
    })

    test('reattaches when the awaited message was already known at dispatch (deleted)', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200)], { hasMoreAfter: false }), {
          afterTime: 100,
          knownNewestTime: 300,
        }),
      )

      expect(windowOf(result).hasNewer).toBe(false)
      expect(windowOf(result).detachedNewestTime).toBeUndefined()
    })

    test('reattaches once the window catches up to what arrived while detached', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(
          historyResponse([textMessage(200), textMessage(300)], {
            hasMoreAfter: false,
          }),
        ),
      )

      expect(windowOf(result).hasNewer).toBe(false)
      expect(windowOf(result).detachedNewestTime).toBeUndefined()
    })

    test('ignores a page fetched for a window that has since been replaced', () => {
      const state = makeState({
        hasNewer: true,
        windowGen: 4,
        loadingNewer: true,
        messages: [textMessage(100)],
      })

      const result = chatReducer(
        state,
        loadNewerMessagesAction(historyResponse([textMessage(200)], { hasMoreAfter: false }), {
          windowGen: 3,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(windowOf(result).hasNewer).toBe(true)
      expect(windowOf(result).loadingNewer).toBe(true)
    })

    test('a failed page clears the loading flag and leaves the window detached', () => {
      const state = makeState({ hasNewer: true, loadingNewer: true, messages: [textMessage(100)] })

      const result = chatReducer(state, asFailure(loadNewerMessagesAction(historyResponse([]))))

      expect(windowOf(result).loadingNewer).toBe(false)
      expect(windowOf(result).hasNewer).toBe(true)
      expect(messageIdsOf(result)).toEqual(['text-100'])
    })
  })

  describe('@chat/resetMessageWindow', () => {
    test('empties the window and returns it to the present', () => {
      const state = makeState({
        messages: [textMessage(100)],
        hasHistory: false,
        hasNewer: true,
        detachedNewestTime: 500,
        loadingNewer: true,
        windowGen: 2,
      })

      const result = chatReducer(state, resetMessageWindowAction())

      const window = windowOf(result)
      expect(window.messages).toEqual([])
      expect(window.hasHistory).toBe(true)
      expect(window.hasNewer).toBe(false)
      expect(window.detachedNewestTime).toBeUndefined()
      expect(window.loadingNewer).toBe(false)
      expect(window.windowGen).toBe(3)
    })
  })

  describe('@chat/activateChannel', () => {
    test('freezes the divider at the read position when the channel has unread messages', () => {
      const state = makeState({ unread: true, lastReadTime: 100 })

      const result = chatReducer(state, activateChannelAction(true))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
      expect(result.unreadChannels.has(CHANNEL_ID)).toBe(false)
      expect(result.activatedChannels.has(CHANNEL_ID)).toBe(true)
    })

    test('records the at-bottom state the view is opening in', () => {
      const state = makeState()

      expect(chatReducer(state, activateChannelAction(true)).atBottomChannels.has(CHANNEL_ID)).toBe(
        true,
      )
      expect(
        chatReducer(state, activateChannelAction(false)).atBottomChannels.has(CHANNEL_ID),
      ).toBe(false)
    })

    test('consumes a divider the read position has passed when opening at the bottom', () => {
      const state = makeState({ lastReadTime: 200, unreadLineTime: 100 })

      const result = chatReducer(state, activateChannelAction(true))

      expect(result.idToUnreadLineTime.has(CHANNEL_ID)).toBe(false)
    })

    test('keeps a divider the read position has passed when opening away from the bottom', () => {
      const state = makeState({ lastReadTime: 200, unreadLineTime: 100 })

      const result = chatReducer(state, activateChannelAction(false))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 100 })

      const result = chatReducer(state, activateChannelAction(true))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })

    test('keeps a divider frozen by this activation', () => {
      const state = makeState({ unread: true, lastReadTime: 100 })

      const result = chatReducer(state, activateChannelAction(true))

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })
  })

  describe('@chat/deactivateChannel', () => {
    test('consumes a divider the read position has passed when left at the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = chatReducer(state, deactivateChannelAction())

      expect(result.idToUnreadLineTime.has(CHANNEL_ID)).toBe(false)
    })

    test('keeps a divider the read position has passed when left away from the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = chatReducer(state, deactivateChannelAction())

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 100,
        unreadLineTime: 100,
      })

      const result = chatReducer(state, deactivateChannelAction())

      expect(result.idToUnreadLineTime.get(CHANNEL_ID)).toBe(100)
    })

    test('drops a detached window entirely', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({
        activated: true,
        hasNewer: true,
        detachedNewestTime: 500,
        messages,
      })

      const result = chatReducer(state, deactivateChannelAction())

      const window = windowOf(result)
      expect(window.messages).toEqual([])
      expect(window.hasNewer).toBe(false)
      expect(window.detachedNewestTime).toBeUndefined()
      expect(window.hasHistory).toBe(true)
      expect(window.windowGen).toBe(1)
    })

    test('dropping a detached window lowers the loading flags of in-flight requests', () => {
      const state = makeState({
        activated: true,
        hasNewer: true,
        loadingHistory: true,
        loadingNewer: true,
        messages: [textMessage(100)],
      })

      const result = chatReducer(state, deactivateChannelAction())

      expect(windowOf(result).loadingHistory).toBe(false)
      expect(windowOf(result).loadingNewer).toBe(false)
    })

    test('trims an attached window down to the history cap', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, messages })

      const result = chatReducer(state, deactivateChannelAction())

      expect(windowOf(result).messages.length).toBe(150)
      expect(windowOf(result).windowGen).toBe(0)
    })
  })
})
