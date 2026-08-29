import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import {
  BasicChannelInfo,
  ChannelTextMessage,
  ChatMessage,
  ChatMessageEvent,
  ClientChatMessageType,
  InitialChannelData,
  SbChannelId,
  SelfJoinChannelMessage,
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
    unread?: boolean
    lastReadTime?: number
    latestMentionTime?: number
    unreadLineTime?: number
  } = {},
): Immutable<ChatState> {
  const state: ChatState = {
    joinedChannels: new Set([CHANNEL_ID]),
    idToBasicInfo: new Map(),
    idToDetailedInfo: new Map(),
    idToJoinedInfo: new Map(),
    idToUsers: new Map(),
    idToMessages: new Map([
      [CHANNEL_ID, { messages: overrides.messages ?? [], loadingHistory: false, hasHistory: true }],
    ]),
    idToUserProfiles: new Map(),
    idToSelfPreferences: new Map(),
    idToSelfPermissions: new Map(),
    activatedChannels: new Set(overrides.activated ? [CHANNEL_ID] : []),
    atBottomChannels: new Set(),
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
})
