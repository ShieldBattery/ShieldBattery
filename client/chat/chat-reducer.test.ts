import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import {
  ChannelTextMessage,
  ChatMessage,
  ClientChatMessageType,
  SbChannelId,
  SelfJoinChannelMessage,
  ServerChatMessageType,
  makeSbChannelId,
} from '../../common/chat'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ChatActions } from './actions'
import chatReducerImport, { ChatState } from './chat-reducer'

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
})
