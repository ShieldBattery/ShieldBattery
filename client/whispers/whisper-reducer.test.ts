import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { CommonMessageType, CommonTextMessage } from '../messaging/message-records'
import { WhisperActions } from './actions'
import whisperReducerImport, { WhisperSession, WhisperState } from './whisper-reducer'

// `immerKeyedReducer` accepts any action with a string `type`. These tests only ever feed it
// whisper actions, so narrow the parameter to those, both for the extra checking and so that action
// objects can be written inline without tripping excess property checks.
const whisperReducer = whisperReducerImport as unknown as (
  state: Immutable<WhisperState>,
  action: WhisperActions,
) => Immutable<WhisperState>

const TARGET_ID = makeSbUserId(2)

// Every whisper message the client stores is a text message from the server, so (unlike chat
// channels) there's no client-local whisper message type whose `time` isn't server-recorded.
function textMessage(time: number): CommonTextMessage {
  return {
    id: `text-${time}`,
    type: CommonMessageType.TextMessage,
    time,
    from: TARGET_ID,
    text: 'hello',
  }
}

function makeState(
  overrides: {
    messages?: CommonTextMessage[]
    activated?: boolean
    unread?: boolean
    lastReadTime?: number
    unreadLineTime?: number
  } = {},
): Immutable<WhisperState> {
  const session: WhisperSession = {
    target: TARGET_ID,
    messages: overrides.messages ?? [],
    hasHistory: true,
    activated: overrides.activated ?? false,
    atBottom: false,
    hasUnread: overrides.unread ?? false,
    lastReadTime: overrides.lastReadTime,
    unreadLineTime: overrides.unreadLineTime,
  }

  const state: WhisperState = {
    sessions: new Set([TARGET_ID]),
    byId: new Map([[TARGET_ID, session]]),
  }

  return state as Immutable<WhisperState>
}

function updateLastReadTimeAction(lastReadTime: number): WhisperActions {
  return {
    type: '@whispers/updateLastReadTime',
    payload: { targetId: TARGET_ID, lastReadTime },
  }
}

describe('client/whispers/whisper-reducer', () => {
  describe('@whispers/updateLastReadTime', () => {
    test('does not regress the stored position when the incoming time is stale', () => {
      const state = makeState({ lastReadTime: 1000 })

      const result = whisperReducer(state, updateLastReadTimeAction(500))

      expect(result.byId.get(TARGET_ID)!.lastReadTime).toBe(1000)
    })

    test('clears unread when no known message is newer than the incoming time', () => {
      const state = makeState({
        unread: true,
        lastReadTime: 100,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)!.hasUnread).toBe(false)
    })

    test('keeps unread when a message is newer than the incoming time', () => {
      const state = makeState({
        unread: true,
        lastReadTime: 100,
        messages: [textMessage(300)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)!.hasUnread).toBe(true)
    })

    test('clears the frozen divider when it is behind the incoming time', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 150 })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)!.unreadLineTime).toBeUndefined()
    })

    test('keeps the frozen divider when it is at or ahead of the incoming time', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 250 })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)!.unreadLineTime).toBe(250)
    })

    test('leaves the unread flag and divider untouched for an activated session', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 100,
        unreadLineTime: 150,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      const session = result.byId.get(TARGET_ID)!
      expect(session.hasUnread).toBe(true)
      expect(session.unreadLineTime).toBe(150)
      // The read position itself still advances even while activated, since this is also the path
      // this session's own optimistic mark-read reports take.
      expect(session.lastReadTime).toBe(200)
    })
  })
})
