import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  GetSessionHistoryResponse,
  WhisperMessage,
  WhisperMessageType,
} from '../../common/whispers'
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
const SELF_ID = makeSbUserId(3)

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
    atBottom?: boolean
    unread?: boolean
    lastReadTime?: number
    unreadLineTime?: number
    hasHistory?: boolean
    loadingHistory?: boolean
    loadingNewer?: boolean
    hasNewer?: boolean
    detachedNewestTime?: number
    windowGen?: number
  } = {},
): Immutable<WhisperState> {
  const session: WhisperSession = {
    target: TARGET_ID,
    messages: overrides.messages ?? [],
    loadingHistory: overrides.loadingHistory ?? false,
    hasHistory: overrides.hasHistory ?? true,
    loadingNewer: overrides.loadingNewer ?? false,
    hasNewer: overrides.hasNewer ?? false,
    detachedNewestTime: overrides.detachedNewestTime,
    windowGen: overrides.windowGen ?? 0,
    activated: overrides.activated ?? false,
    atBottom: overrides.atBottom ?? false,
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

/** A message in the shape the server sends it, before the reducer converts it for the list. */
function serverMessage(time: number): WhisperMessage {
  return {
    id: `text-${time}`,
    type: WhisperMessageType.TextMessage,
    from: TARGET_ID,
    to: SELF_ID,
    time,
    text: 'hello',
  }
}

const HISTORY_LIMIT = 50

function historyResponse(
  messages: WhisperMessage[],
  {
    hasMoreBefore = true,
    hasMoreAfter = true,
  }: { hasMoreBefore?: boolean; hasMoreAfter?: boolean } = {},
): GetSessionHistoryResponse {
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

function loadMessageHistoryBeginAction({
  windowGen = 0,
  beforeTime = -1,
}: { windowGen?: number; beforeTime?: number } = {}): WhisperActions {
  return {
    type: '@whispers/loadMessageHistoryBegin',
    payload: { target: TARGET_ID, limit: HISTORY_LIMIT, beforeTime, windowGen },
  }
}

function loadNewerMessagesBeginAction({
  windowGen = 0,
  afterTime = 0,
  knownNewestTime = afterTime,
}: { windowGen?: number; afterTime?: number; knownNewestTime?: number } = {}): WhisperActions {
  return {
    type: '@whispers/loadNewerMessagesBegin',
    payload: { target: TARGET_ID, limit: HISTORY_LIMIT, afterTime, windowGen, knownNewestTime },
  }
}

function loadMessagesAroundBeginAction({
  windowGen = 0,
  aroundTime = 0,
  knownNewestTime,
}: { windowGen?: number; aroundTime?: number; knownNewestTime?: number } = {}): WhisperActions {
  return {
    type: '@whispers/loadMessagesAroundBegin',
    payload: { target: TARGET_ID, limit: HISTORY_LIMIT, aroundTime, windowGen, knownNewestTime },
  }
}

function loadMessageHistoryAction(
  payload: GetSessionHistoryResponse,
  { windowGen = 0, beforeTime = -1 }: { windowGen?: number; beforeTime?: number } = {},
): WhisperActions {
  return {
    type: '@whispers/loadMessageHistory',
    payload,
    meta: { target: TARGET_ID, limit: HISTORY_LIMIT, beforeTime, windowGen },
  }
}

function loadNewerMessagesAction(
  payload: GetSessionHistoryResponse,
  {
    windowGen = 0,
    afterTime = 0,
    knownNewestTime = afterTime,
  }: { windowGen?: number; afterTime?: number; knownNewestTime?: number } = {},
): WhisperActions {
  return {
    type: '@whispers/loadNewerMessages',
    payload,
    meta: { target: TARGET_ID, limit: HISTORY_LIMIT, afterTime, windowGen, knownNewestTime },
  }
}

function loadMessagesAroundAction(
  payload: GetSessionHistoryResponse,
  {
    windowGen = 0,
    aroundTime = 0,
    knownNewestTime,
  }: { windowGen?: number; aroundTime?: number; knownNewestTime?: number } = {},
): WhisperActions {
  return {
    type: '@whispers/loadMessagesAround',
    payload,
    meta: { target: TARGET_ID, limit: HISTORY_LIMIT, aroundTime, windowGen, knownNewestTime },
  }
}

function updateMessageAction(time: number): WhisperActions {
  return {
    type: '@whispers/updateMessage',
    payload: {
      action: 'message',
      message: serverMessage(time),
      users: [],
      mentions: [],
      channelMentions: [],
    },
    meta: { target: TARGET_ID },
  }
}

function resetMessageWindowAction(): WhisperActions {
  return {
    type: '@whispers/resetMessageWindow',
    payload: { target: TARGET_ID },
  }
}

function activateSessionAction(restoredUnreadLineTime?: number): WhisperActions {
  return {
    type: '@whispers/activateWhisperSession',
    payload: { target: TARGET_ID, restoredUnreadLineTime },
  }
}

function deactivateSessionAction(): WhisperActions {
  return {
    type: '@whispers/deactivateWhisperSession',
    payload: { target: TARGET_ID },
  }
}

/** Rewrites a request action into the rejected form the promise middleware dispatches. */
function asFailure(action: WhisperActions): WhisperActions {
  return {
    ...action,
    payload: new Error('request failed'),
    error: true,
  } as unknown as WhisperActions
}

function sessionOf(state: Immutable<WhisperState>) {
  return state.byId.get(TARGET_ID)!
}

function messageIdsOf(state: Immutable<WhisperState>): string[] {
  return sessionOf(state).messages.map(m => m.id)
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

  describe('@whispers/loadMessageHistory', () => {
    test('takes the older edge straight from the response instead of inferring it', () => {
      const state = makeState()

      // A short page that nonetheless has more behind it: the count says nothing about the edge.
      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(100)], { hasMoreBefore: true })),
      )

      expect(sessionOf(result).hasHistory).toBe(true)
    })

    test('clears the older edge when the response says there is nothing more', () => {
      const state = makeState()

      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(100)], { hasMoreBefore: false })),
      )

      expect(sessionOf(result).hasHistory).toBe(false)
    })

    test('drops messages the window already holds at the seam', () => {
      const state = makeState({ messages: [textMessage(100), textMessage(200)] })

      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(50), serverMessage(100)])),
      )

      expect(messageIdsOf(result)).toEqual(['text-50', 'text-100', 'text-200'])
    })

    test('ignores a page fetched for a window that has since been replaced', () => {
      const state = makeState({ messages: [textMessage(200)], windowGen: 3 })

      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(100)], { hasMoreBefore: false }), {
          windowGen: 2,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-200'])
      expect(sessionOf(result).hasHistory).toBe(true)
    })

    test('a failed page leaves the window untouched', () => {
      const state = makeState({ messages: [textMessage(200)] })

      const result = whisperReducer(state, asFailure(loadMessageHistoryAction(historyResponse([]))))

      expect(messageIdsOf(result)).toEqual(['text-200'])
      expect(sessionOf(result).hasHistory).toBe(true)
    })
  })

  describe('@whispers/loadMessagesAround', () => {
    test('replaces the window and detaches it from the present', () => {
      const state = makeState({ messages: [textMessage(900)] })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([serverMessage(100), serverMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: true,
          }),
          { aroundTime: 150 },
        ),
      )

      const session = sessionOf(result)
      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(session.hasHistory).toBe(true)
      expect(session.hasNewer).toBe(true)
      expect(session.windowGen).toBe(1)
    })

    test('lands attached when the fetched window reaches the newest message', () => {
      const state = makeState({ hasNewer: true, detachedNewestTime: 500 })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([serverMessage(400), serverMessage(500)], {
            hasMoreBefore: false,
            hasMoreAfter: false,
          }),
        ),
      )

      expect(sessionOf(result).hasNewer).toBe(false)
      expect(sessionOf(result).hasHistory).toBe(false)
      expect(sessionOf(result).detachedNewestTime).toBeUndefined()
    })

    test('stays detached when a message arrived while the request was in flight', () => {
      // Messages up to 500 were known when the request was dispatched (knownNewestTime), and
      // another arrived at 600 before the response landed, so the replacement window ending at 200
      // cannot have caught the present even though the server saw nothing newer.
      const state = makeState({ messages: [textMessage(500), textMessage(600)] })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([serverMessage(100), serverMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: false,
          }),
          { aroundTime: 150, knownNewestTime: 500 },
        ),
      )

      expect(sessionOf(result).hasNewer).toBe(true)
      expect(sessionOf(result).detachedNewestTime).toBe(600)
    })

    test('lands attached when everything past the window was already known at dispatch', () => {
      // The newest loaded message (600) was known when the request was dispatched, so the server
      // not returning anything newer than 200 means the newer messages have been deleted.
      const state = makeState({ messages: [textMessage(500), textMessage(600)] })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(
          historyResponse([serverMessage(100), serverMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: false,
          }),
          { aroundTime: 150, knownNewestTime: 600 },
        ),
      )

      expect(sessionOf(result).hasNewer).toBe(false)
      expect(sessionOf(result).detachedNewestTime).toBeUndefined()
    })

    test('ignores a response fetched for a window that has since been replaced', () => {
      const state = makeState({ messages: [textMessage(900)], windowGen: 2 })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(historyResponse([serverMessage(100)]), { windowGen: 1 }),
      )

      expect(messageIdsOf(result)).toEqual(['text-900'])
      expect(sessionOf(result).windowGen).toBe(2)
    })
  })

  describe('a detached message window', () => {
    test('does not append a live message, but records how far the present has run ahead', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(sessionOf(result).detachedNewestTime).toBe(500)
    })

    test('keeps the newest time when an older message arrives afterwards', () => {
      const state = makeState({ hasNewer: true, detachedNewestTime: 500 })

      const result = whisperReducer(state, updateMessageAction(400))

      expect(sessionOf(result).detachedNewestTime).toBe(500)
    })

    test('a live message still marks the session unread', () => {
      const state = makeState({ hasNewer: true })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test('a live message freezes the unread divider even at the bottom of the loaded window', () => {
      const state = makeState({
        hasNewer: true,
        activated: true,
        atBottom: true,
        lastReadTime: 100,
      })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('an attached session at the bottom does not freeze the divider', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(sessionOf(result).unreadLineTime).toBeUndefined()
    })

    test('is never trimmed while it grows, even when the view is at the bottom of it', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ hasNewer: true, activated: true, atBottom: true, messages })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(1000)]), { afterTime: 200 }),
      )

      expect(sessionOf(result).messages.length).toBe(201)
    })

    test('is not trimmed when the view returns to the bottom of it', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ hasNewer: true, activated: true, messages })

      const result = whisperReducer(state, {
        type: '@whispers/updateSessionAtBottom',
        payload: { target: TARGET_ID, atBottom: true },
      })

      expect(sessionOf(result).messages.length).toBe(200)
    })
  })

  describe('@whispers/updateMessage', () => {
    test('a live message defers the trim of a pinned window while an older page is in flight', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, atBottom: true, loadingHistory: true, messages })

      const result = whisperReducer(state, updateMessageAction(1000))

      // Trimming here would drop the messages the in-flight page was fetched against, leaving a
      // gap between it and the window once it lands.
      expect(sessionOf(result).messages.length).toBe(201)
      expect(sessionOf(result).windowGen).toBe(0)
    })

    test('a live message trims a pinned window down to the history cap once nothing is in flight', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, atBottom: true, messages })

      const result = whisperReducer(state, updateMessageAction(1000))

      expect(sessionOf(result).messages.length).toBe(150)
    })
  })

  describe('@whispers/loadNewerMessages', () => {
    test('appends the page and reattaches once the server has nothing newer', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)], { hasMoreAfter: false }), {
          afterTime: 100,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(sessionOf(result).hasNewer).toBe(false)
    })

    test('drops messages the window already holds at the seam', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100), textMessage(200)] })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200), serverMessage(300)])),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200', 'text-300'])
    })

    test('stays detached while the server still has newer messages', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)], { hasMoreAfter: true })),
      )

      expect(sessionOf(result).hasNewer).toBe(true)
    })

    test('stays detached when a message arrived past the end of the final page', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)], { hasMoreAfter: false })),
      )

      expect(sessionOf(result).hasNewer).toBe(true)
      expect(sessionOf(result).detachedNewestTime).toBe(300)
    })

    test('reattaches when the awaited message was already known at dispatch (deleted)', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)], { hasMoreAfter: false }), {
          afterTime: 100,
          knownNewestTime: 300,
        }),
      )

      expect(sessionOf(result).hasNewer).toBe(false)
      expect(sessionOf(result).detachedNewestTime).toBeUndefined()
    })

    test('reattaches once the window catches up to what arrived while detached', () => {
      const state = makeState({
        hasNewer: true,
        detachedNewestTime: 300,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(
          historyResponse([serverMessage(200), serverMessage(300)], { hasMoreAfter: false }),
        ),
      )

      expect(sessionOf(result).hasNewer).toBe(false)
      expect(sessionOf(result).detachedNewestTime).toBeUndefined()
    })

    test('ignores a page fetched for a window that has since been replaced', () => {
      const state = makeState({ hasNewer: true, windowGen: 4, messages: [textMessage(100)] })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)], { hasMoreAfter: false }), {
          windowGen: 3,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(sessionOf(result).hasNewer).toBe(true)
    })

    test('a failed page leaves the window detached and untouched', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(state, asFailure(loadNewerMessagesAction(historyResponse([]))))

      expect(sessionOf(result).hasNewer).toBe(true)
      expect(messageIdsOf(result)).toEqual(['text-100'])
    })
  })

  describe('@whispers/resetMessageWindow', () => {
    test('empties the window and returns it to the present', () => {
      const state = makeState({
        messages: [textMessage(100)],
        hasHistory: false,
        hasNewer: true,
        detachedNewestTime: 500,
        windowGen: 2,
      })

      const result = whisperReducer(state, resetMessageWindowAction())

      const session = sessionOf(result)
      expect(session.messages).toEqual([])
      expect(session.hasHistory).toBe(true)
      expect(session.hasNewer).toBe(false)
      expect(session.detachedNewestTime).toBeUndefined()
      expect(session.windowGen).toBe(3)
    })
  })

  describe('@whispers/activateWhisperSession', () => {
    test('freezes the divider at the read position when the session has unread messages', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      const session = sessionOf(result)
      expect(session.unreadLineTime).toBe(100)
      expect(session.hasUnread).toBe(false)
      expect(session.activated).toBe(true)
    })

    test('leaves the at-bottom state the view reported in place', () => {
      expect(
        sessionOf(whisperReducer(makeState({ atBottom: true }), activateSessionAction())).atBottom,
      ).toBe(true)
      expect(sessionOf(whisperReducer(makeState(), activateSessionAction())).atBottom).toBe(false)
    })

    test('consumes a divider the read position has passed when opening at the bottom', () => {
      const state = makeState({ lastReadTime: 200, unreadLineTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBeUndefined()
    })

    test('keeps a divider the read position has passed when opening away from the bottom', () => {
      const state = makeState({ lastReadTime: 200, unreadLineTime: 100 })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('keeps a divider frozen by this activation', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('takes a restored divider when the session has none', () => {
      const state = makeState({ lastReadTime: 300 })

      const result = whisperReducer(state, activateSessionAction(100))

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('keeps the divider it already has over a restored one', () => {
      const state = makeState({ lastReadTime: 300, unreadLineTime: 200 })

      const result = whisperReducer(state, activateSessionAction(100))

      expect(sessionOf(result).unreadLineTime).toBe(200)
    })

    test('a restored divider takes the place of the one this activation would freeze', () => {
      const state = makeState({ unread: true, lastReadTime: 300 })

      const result = whisperReducer(state, activateSessionAction(100))

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('a restored divider the read position has passed is consumed at the bottom', () => {
      const state = makeState({ lastReadTime: 300, atBottom: true })

      const result = whisperReducer(state, activateSessionAction(100))

      expect(sessionOf(result).unreadLineTime).toBeUndefined()
    })
  })

  describe('@whispers/deactivateWhisperSession', () => {
    test('consumes a divider the read position has passed when left at the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBeUndefined()
    })

    test('keeps a divider the read position has passed when left away from the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 100,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('drops a detached window entirely', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({
        activated: true,
        hasNewer: true,
        detachedNewestTime: 500,
        messages,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      const session = sessionOf(result)
      expect(session.messages).toEqual([])
      expect(session.hasNewer).toBe(false)
      expect(session.detachedNewestTime).toBeUndefined()
      expect(session.hasHistory).toBe(true)
      expect(session.windowGen).toBe(1)
    })

    test('keeps a divider when the bottom of the window is not the newest message', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        hasNewer: true,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLineTime).toBe(100)
    })

    test('trims an attached window down to the history cap', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, messages })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).messages.length).toBe(150)
    })

    test('leaves the generation alone when nothing is in flight to invalidate', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, messages })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).windowGen).toBe(0)
    })

    test('lowers the loading flags of an attached window, so a request that never settles cannot wedge them', () => {
      const state = makeState({
        activated: true,
        loadingHistory: true,
        loadingNewer: true,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).loadingHistory).toBe(false)
      expect(sessionOf(result).loadingNewer).toBe(false)
    })

    test('dropping a detached window lowers the loading flags of in-flight requests', () => {
      const state = makeState({
        activated: true,
        hasNewer: true,
        loadingHistory: true,
        loadingNewer: true,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).loadingHistory).toBe(false)
      expect(sessionOf(result).loadingNewer).toBe(false)
    })

    test('discards a page fetched against the older edge the trim moves', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, loadingHistory: true, messages })

      const deactivated = whisperReducer(state, deactivateSessionAction())
      expect(sessionOf(deactivated).windowGen).toBe(1)
      expect(sessionOf(deactivated).messages.length).toBe(150)

      // The page was fetched for the messages the trim just removed, so applying it would leave
      // the window holding it directly in front of a gap.
      const result = whisperReducer(
        deactivated,
        loadMessageHistoryAction(historyResponse([serverMessage(0)]), {
          windowGen: 0,
          beforeTime: 1,
        }),
      )

      expect(messageIdsOf(result)).toEqual(messageIdsOf(deactivated))
      expect(sessionOf(result).loadingHistory).toBe(false)
    })
  })

  describe('@whispers/updateSessionAtBottom', () => {
    test('trims scrollback down to the history cap when the view returns to the bottom', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, messages })

      const result = whisperReducer(state, {
        type: '@whispers/updateSessionAtBottom',
        payload: { target: TARGET_ID, atBottom: true },
      })

      expect(sessionOf(result).messages.length).toBe(150)
    })

    test('defers the trim while an older page is in flight, keeping the window it was fetched for', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, loadingHistory: true, messages })

      const result = whisperReducer(state, {
        type: '@whispers/updateSessionAtBottom',
        payload: { target: TARGET_ID, atBottom: true },
      })

      expect(sessionOf(result).messages.length).toBe(200)
      expect(sessionOf(result).windowGen).toBe(0)
    })

    test('a page in flight lands contiguously on the window it was fetched for', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      let result = whisperReducer(makeState({ activated: true, loadingHistory: true, messages }), {
        type: '@whispers/updateSessionAtBottom',
        payload: { target: TARGET_ID, atBottom: true },
      })
      // Scrolling away again before the page lands leaves nothing to trim the seam afterwards, so
      // a window trimmed past the page's boundary would keep the gap for as long as it's loaded.
      result = whisperReducer(result, {
        type: '@whispers/updateSessionAtBottom',
        payload: { target: TARGET_ID, atBottom: false },
      })
      result = whisperReducer(
        result,
        loadMessageHistoryAction(historyResponse([serverMessage(0)]), { beforeTime: 1 }),
      )

      expect(messageIdsOf(result)).toEqual(['text-0', ...messages.map(m => m.id)])
    })
  })

  describe('loading flags', () => {
    test('an older-page request raises the older edge flag and its response lowers it', () => {
      let result = whisperReducer(makeState(), loadMessageHistoryBeginAction())
      expect(sessionOf(result).loadingHistory).toBe(true)

      result = whisperReducer(
        result,
        loadMessageHistoryAction(historyResponse([serverMessage(100)])),
      )
      expect(sessionOf(result).loadingHistory).toBe(false)
    })

    test('a failed older-page request lowers the older edge flag', () => {
      let result = whisperReducer(makeState(), loadMessageHistoryBeginAction())
      result = whisperReducer(result, asFailure(loadMessageHistoryAction(historyResponse([]))))

      expect(sessionOf(result).loadingHistory).toBe(false)
    })

    test('a newer-page request raises the newer edge flag and its response lowers it', () => {
      let result = whisperReducer(
        makeState({ hasNewer: true, messages: [textMessage(100)] }),
        loadNewerMessagesBeginAction({ afterTime: 100 }),
      )
      expect(sessionOf(result).loadingNewer).toBe(true)

      result = whisperReducer(
        result,
        loadNewerMessagesAction(historyResponse([serverMessage(200)]), { afterTime: 100 }),
      )
      expect(sessionOf(result).loadingNewer).toBe(false)
    })

    test('a failed newer-page request lowers the newer edge flag', () => {
      let result = whisperReducer(
        makeState({ hasNewer: true, messages: [textMessage(100)] }),
        loadNewerMessagesBeginAction({ afterTime: 100 }),
      )
      result = whisperReducer(
        result,
        asFailure(loadNewerMessagesAction(historyResponse([]), { afterTime: 100 })),
      )

      expect(sessionOf(result).loadingNewer).toBe(false)
    })

    test('a window replacement waits on the older edge affordance and lowers both flags', () => {
      let result = whisperReducer(makeState(), loadMessagesAroundBeginAction({ aroundTime: 150 }))
      expect(sessionOf(result).loadingHistory).toBe(true)

      result = whisperReducer(
        result,
        loadMessagesAroundAction(historyResponse([serverMessage(150)]), { aroundTime: 150 }),
      )
      expect(sessionOf(result).loadingHistory).toBe(false)
      expect(sessionOf(result).loadingNewer).toBe(false)
    })

    test('a response discarded by the generation check leaves the flag alone', () => {
      const state = makeState({ loadingHistory: true, windowGen: 2 })

      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(100)]), { windowGen: 1 }),
      )

      expect(sessionOf(result).loadingHistory).toBe(true)
      expect(messageIdsOf(result)).toEqual([])
    })

    test('dropping the window lowers both flags', () => {
      const state = makeState({ loadingHistory: true, loadingNewer: true })

      const result = whisperReducer(state, resetMessageWindowAction())

      expect(sessionOf(result).loadingHistory).toBe(false)
      expect(sessionOf(result).loadingNewer).toBe(false)
    })
  })
})
