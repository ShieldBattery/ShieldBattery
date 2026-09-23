import { Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  GetSessionHistoryResponse,
  WhisperMessage,
  WhisperMessageType,
} from '../../common/whispers'
import { MessagingActions } from '../messaging/actions'
import type { HistoryLoadError } from '../messaging/message-load-error'
import {
  CommonMessageType,
  CommonTextMessage,
  CommonWhisperEchoMessage,
  LocalMessage,
} from '../messaging/message-records'
import { WhisperActions } from './actions'
import whisperReducerImport, {
  hasAttentionWorthyWhisper,
  newestKnownWhisperTime,
  WhisperSession,
  WhisperSessionMessage,
  WhisperState,
} from './whisper-reducer'

// `immerKeyedReducer` accepts any action with a string `type`. These tests only ever feed it
// whisper actions, so narrow the parameter to those, both for the extra checking and so that action
// objects can be written inline without tripping excess property checks.
const whisperReducer = whisperReducerImport as unknown as (
  state: Immutable<WhisperState>,
  action: WhisperActions | MessagingActions,
) => Immutable<WhisperState>

const TARGET_ID = makeSbUserId(2)
const SELF_ID = makeSbUserId(3)
const OTHER_ID = makeSbUserId(4)

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

/** A message this client puts in the session itself, which the server has no record of here. */
function echoMessage(id: string, time: number): CommonWhisperEchoMessage {
  return {
    id,
    type: CommonMessageType.WhisperEcho,
    time,
    direction: 'incoming',
    counterpartId: OTHER_ID,
    text: 'hello from elsewhere',
  }
}

function appendLocalMessageAction(message: LocalMessage): MessagingActions {
  return {
    type: '@messaging/appendLocalMessage',
    payload: { target: { surface: 'whisper', userId: TARGET_ID }, message },
  }
}

function makeState(
  overrides: {
    messages?: WhisperSessionMessage[]
    carriedClientMessages?: LocalMessage[]
    activated?: boolean
    atBottom?: boolean
    unread?: boolean
    lastReadTime?: number
    latestUnreadTime?: number
    unreadLineTime?: number
    unreadLineSeen?: boolean
    unreadLineLeftBottom?: boolean
    hasHistory?: boolean
    loadingHistory?: boolean
    loadingNewer?: boolean
    hasNewer?: boolean
    detachedNewestTime?: number
    windowGen?: number
    historyError?: HistoryLoadError
    newerError?: boolean
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
    carriedClientMessages: overrides.carriedClientMessages ?? [],
    historyError: overrides.historyError,
    newerError: overrides.newerError ?? false,
    activated: overrides.activated ?? false,
    atBottom: overrides.atBottom ?? false,
    hasUnread: overrides.unread ?? false,
    lastReadTime: overrides.lastReadTime,
    latestUnreadTime: overrides.latestUnreadTime,
    unreadLine:
      overrides.unreadLineTime !== undefined
        ? {
            time: overrides.unreadLineTime,
            seen: overrides.unreadLineSeen ?? false,
            leftBottom: overrides.unreadLineLeftBottom ?? false,
          }
        : undefined,
  }

  const state: WhisperState = {
    sessions: new Set([TARGET_ID]),
    byId: new Map([[TARGET_ID, session]]),
  }

  return state as Immutable<WhisperState>
}

function getWhisperSessionsAction(lastReadTime: number, latestUnreadTime?: number): WhisperActions {
  return {
    type: '@whispers/getWhisperSessions',
    payload: {
      sessions: [TARGET_ID],
      users: [],
      lastReadTimes: [{ targetId: TARGET_ID, lastReadTime, latestUnreadTime }],
    },
  }
}

/**
 * The state a reconnect leaves behind: every session cleared, ahead of the session list that
 * refills it. A mark-read relayed from another of the user's sessions can land in this window.
 */
function reconnectedState(): Immutable<WhisperState> {
  return whisperReducer(makeState(), { type: '@network/connect' } as unknown as WhisperActions)
}

function updateLastReadTimeAction(
  lastReadTime: number,
  dismissUnreadLine?: boolean,
): WhisperActions {
  return {
    type: '@whispers/updateLastReadTime',
    payload: { targetId: TARGET_ID, lastReadTime, dismissUnreadLine },
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

function updateMessageAction(
  time: number,
  windowFocused = true,
  isSelfMessage = false,
): WhisperActions {
  return {
    type: '@whispers/updateMessage',
    payload: {
      action: 'message',
      message: serverMessage(time),
      users: [],
      mentions: [],
      channelMentions: [],
    },
    meta: { target: TARGET_ID, isSelfMessage, windowFocused },
  }
}

function resetMessageWindowAction(): WhisperActions {
  return {
    type: '@whispers/resetMessageWindow',
    payload: { target: TARGET_ID },
  }
}

function activateSessionAction(): WhisperActions {
  return {
    type: '@whispers/activateWhisperSession',
    payload: { target: TARGET_ID },
  }
}

function deactivateSessionAction(): WhisperActions {
  return {
    type: '@whispers/deactivateWhisperSession',
    payload: { target: TARGET_ID },
  }
}

function updateSessionAtBottomAction(atBottom: boolean): WhisperActions {
  return {
    type: '@whispers/updateSessionAtBottom',
    payload: { target: TARGET_ID, atBottom },
  }
}

function unreadLineSeenAction(time: number, target = TARGET_ID): WhisperActions {
  return {
    type: '@whispers/unreadLineSeen',
    payload: { target, time },
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
  describe('@whispers/getWhisperSessions', () => {
    test('seeds the unread flag from the server, for a session on screen as well', () => {
      const state = makeState({ activated: true, atBottom: true })

      const result = whisperReducer(state, {
        type: '@whispers/getWhisperSessions',
        payload: {
          sessions: [TARGET_ID],
          users: [],
          lastReadTimes: [{ targetId: TARGET_ID, lastReadTime: 100, latestUnreadTime: 300 }],
        },
      })

      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test('seeds how far the unread backlog runs alongside the flag', () => {
      const state = makeState()

      const result = whisperReducer(state, {
        type: '@whispers/getWhisperSessions',
        payload: {
          sessions: [TARGET_ID],
          users: [],
          lastReadTimes: [{ targetId: TARGET_ID, lastReadTime: 100, latestUnreadTime: 300 }],
        },
      })

      expect(sessionOf(result).latestUnreadTime).toBe(300)
      expect(newestKnownWhisperTime(sessionOf(result))).toBe(300)
    })

    test('leaves a session read when the server reports no unread backlog', () => {
      const state = makeState()

      const result = whisperReducer(state, {
        type: '@whispers/getWhisperSessions',
        payload: {
          sessions: [TARGET_ID],
          users: [],
          lastReadTimes: [{ targetId: TARGET_ID, lastReadTime: 100 }],
        },
      })

      expect(sessionOf(result).hasUnread).toBe(false)
      expect(sessionOf(result).latestUnreadTime).toBeUndefined()
    })

    test('keeps a read position that arrived first, and lowers the badge the list seeds', () => {
      const state = whisperReducer(reconnectedState(), updateLastReadTimeAction(200))

      const result = whisperReducer(state, getWhisperSessionsAction(100, 150))

      expect(sessionOf(result).lastReadTime).toBe(200)
      expect(sessionOf(result).hasUnread).toBe(false)
    })

    test('lands in the same place whichever of the list and the read update arrives first', () => {
      const readFirst = whisperReducer(
        whisperReducer(reconnectedState(), updateLastReadTimeAction(200)),
        getWhisperSessionsAction(100, 150),
      )
      const listFirst = whisperReducer(
        whisperReducer(reconnectedState(), getWhisperSessionsAction(100, 150)),
        updateLastReadTimeAction(200),
      )

      expect(sessionOf(readFirst).lastReadTime).toBe(200)
      expect(sessionOf(readFirst).hasUnread).toBe(false)
      expect(sessionOf(listFirst).lastReadTime).toBe(sessionOf(readFirst).lastReadTime)
      expect(sessionOf(listFirst).hasUnread).toBe(sessionOf(readFirst).hasUnread)
    })

    test('keeps the badge up when the read position that arrived first stops short of the backlog', () => {
      const state = whisperReducer(reconnectedState(), updateLastReadTimeAction(200))

      const result = whisperReducer(state, getWhisperSessionsAction(100, 300))

      expect(sessionOf(result).lastReadTime).toBe(200)
      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test('takes the list position when it is newer than one already recorded', () => {
      const state = whisperReducer(reconnectedState(), updateLastReadTimeAction(100))

      const result = whisperReducer(state, getWhisperSessionsAction(200, 150))

      expect(sessionOf(result).lastReadTime).toBe(200)
      expect(sessionOf(result).hasUnread).toBe(false)
    })
  })

  describe('@whispers/updateLastReadTime', () => {
    test('records a position for a session it holds nothing for, without listing that session', () => {
      const result = whisperReducer(reconnectedState(), updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)?.lastReadTime).toBe(200)
      expect(result.byId.get(TARGET_ID)?.hasUnread).toBe(false)
      expect(result.sessions.has(TARGET_ID)).toBe(false)
    })

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

      expect(result.byId.get(TARGET_ID)!.unreadLine).toBeUndefined()
    })

    test('keeps the frozen divider when it is at or ahead of the incoming time', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 250 })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(result.byId.get(TARGET_ID)!.unreadLine?.time).toBe(250)
    })

    test('leaves the divider untouched for an activated session', () => {
      const state = makeState({
        activated: true,
        lastReadTime: 100,
        unreadLineTime: 150,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      const session = result.byId.get(TARGET_ID)!
      expect(session.unreadLine?.time).toBe(150)
      // The read position itself still advances even while activated, since this is also the path
      // this session's own optimistic mark-read reports take.
      expect(session.lastReadTime).toBe(200)
    })

    test('drops the frozen divider of an activated session when dismissing it', () => {
      const state = makeState({
        activated: true,
        unreadLineTime: 100,
        lastReadTime: 100,
        messages: [textMessage(150)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200, true))

      const session = sessionOf(result)
      expect(session.unreadLine).toBeUndefined()
      expect(session.hasUnread).toBe(false)
    })

    test('drops a seen divider once the read report following a return to the bottom lands', () => {
      // Messages arrive while the user is reading scrollback, so the divider is frozen where they
      // left off; going back to the bottom is what retires it, but only once the read report from
      // there has moved the position past it.
      let result = whisperReducer(
        makeState({ activated: true, atBottom: true, lastReadTime: 100 }),
        updateSessionAtBottomAction(false),
      )
      result = whisperReducer(result, updateMessageAction(200))
      expect(sessionOf(result).unreadLine?.time).toBe(100)

      result = whisperReducer(result, unreadLineSeenAction(100))
      result = whisperReducer(result, updateSessionAtBottomAction(true))
      expect(sessionOf(result).unreadLine?.time).toBe(100)

      result = whisperReducer(result, updateLastReadTimeAction(200))

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('keeps a divider the user never looked at for a session at the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        unreadLineTime: 100,
        unreadLineLeftBottom: true,
        lastReadTime: 100,
        messages: [textMessage(200)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a seen divider while the view is away from the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineSeen: true,
        unreadLineLeftBottom: true,
        lastReadTime: 100,
        messages: [textMessage(200)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('clears an activated session flag once the position covers the newest message', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 50,
        unreadLineTime: 50,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(100))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(false)
      expect(session.unreadLine?.time).toBe(50)
    })

    test('keeps an activated session flag while the position is behind the newest message', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 50,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(99))

      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test('keeps the flag when a detached present has run past what the position covers', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 50,
        hasNewer: true,
        detachedNewestTime: 200,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(100))

      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test('keeps the flag when a partial read falls short of a backlog with no history loaded', () => {
      const state = makeState({ unread: true, lastReadTime: 100, latestUnreadTime: 300 })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(sessionOf(result).hasUnread).toBe(true)
      expect(sessionOf(result).lastReadTime).toBe(200)
    })

    test('clears the flag when a read covers a backlog with no history loaded', () => {
      const state = makeState({ unread: true, lastReadTime: 100, latestUnreadTime: 300 })

      const result = whisperReducer(state, updateLastReadTimeAction(300))

      expect(sessionOf(result).hasUnread).toBe(false)
    })

    test('answers a partial read the same way whether or not the backlog is loaded', () => {
      const unloaded = makeState({ unread: true, lastReadTime: 100, latestUnreadTime: 300 })
      const loaded = makeState({
        unread: true,
        lastReadTime: 100,
        latestUnreadTime: 300,
        messages: [textMessage(300)],
      })

      expect(sessionOf(whisperReducer(unloaded, updateLastReadTimeAction(200))).hasUnread).toBe(
        true,
      )
      expect(sessionOf(whisperReducer(loaded, updateLastReadTimeAction(200))).hasUnread).toBe(true)

      expect(sessionOf(whisperReducer(unloaded, updateLastReadTimeAction(300))).hasUnread).toBe(
        false,
      )
      expect(sessionOf(whisperReducer(loaded, updateLastReadTimeAction(300))).hasUnread).toBe(false)
    })

    test('keeps the flag when a detached window ends older than the unread backlog', () => {
      const state = makeState({
        activated: true,
        unread: true,
        lastReadTime: 100,
        latestUnreadTime: 300,
        hasNewer: true,
        messages: [textMessage(150)],
      })

      const result = whisperReducer(state, updateLastReadTimeAction(200))

      expect(sessionOf(result).hasUnread).toBe(true)
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

    test('a failed page records an error for the older edge', () => {
      const state = makeState({ messages: [textMessage(200)], loadingHistory: true })

      const result = whisperReducer(state, asFailure(loadMessageHistoryAction(historyResponse([]))))

      expect(sessionOf(result).historyError).toEqual({ kind: 'history' })
    })

    test('requesting the older edge again clears its error', () => {
      const state = makeState({ historyError: { kind: 'history' } })

      const result = whisperReducer(state, loadMessageHistoryBeginAction())

      expect(sessionOf(result).historyError).toBeUndefined()
    })

    test('a page that lands clears an older edge error an earlier request left behind', () => {
      const state = makeState({ historyError: { kind: 'history' }, loadingHistory: true })

      const result = whisperReducer(
        state,
        loadMessageHistoryAction(historyResponse([serverMessage(100)])),
      )

      expect(sessionOf(result).historyError).toBeUndefined()
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

    test('a failed replacement records the time it was asked for, so a retry can ask again', () => {
      const state = makeState({ loadingHistory: true })

      const result = whisperReducer(
        state,
        asFailure(loadMessagesAroundAction(historyResponse([]), { aroundTime: 150 })),
      )

      expect(sessionOf(result).historyError).toEqual({ kind: 'around', aroundTime: 150 })
    })

    test('requesting a replacement window clears the older edge error', () => {
      const state = makeState({ historyError: { kind: 'history' } })

      const result = whisperReducer(state, loadMessagesAroundBeginAction({ aroundTime: 150 }))

      expect(sessionOf(result).historyError).toBeUndefined()
    })

    test('a replacement that lands clears an older edge error an earlier request left behind', () => {
      const state = makeState({
        historyError: { kind: 'around', aroundTime: 150 },
        loadingHistory: true,
      })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(historyResponse([serverMessage(100)]), { aroundTime: 150 }),
      )

      expect(sessionOf(result).historyError).toBeUndefined()
    })

    test('a replacement window clears the newer edge error along with the messages it belonged to', () => {
      const state = makeState({ messages: [textMessage(900)], newerError: true })

      const result = whisperReducer(
        state,
        loadMessagesAroundAction(historyResponse([serverMessage(100)]), { aroundTime: 150 }),
      )

      expect(sessionOf(result).newerError).toBe(false)
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

    test('a live message goes unread at the bottom of the loaded window, freezing the divider', () => {
      const state = makeState({
        hasNewer: true,
        activated: true,
        atBottom: true,
        lastReadTime: 100,
      })

      const result = whisperReducer(state, updateMessageAction(500))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(true)
      expect(session.unreadLine?.time).toBe(100)
      expect(session.lastReadTime).toBe(100)
    })

    test('a live message past a detached window re-freezes a divider the read position has passed', () => {
      const state = makeState({
        hasNewer: true,
        activated: true,
        atBottom: true,
        unreadLineTime: 100,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, updateMessageAction(500))

      const session = sessionOf(result)
      expect(session.unreadLine?.time).toBe(200)
      expect(session.hasUnread).toBe(true)
      expect(session.detachedNewestTime).toBe(500)
    })

    test('an attached session at the bottom does not freeze the divider', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(sessionOf(result).unreadLine).toBeUndefined()
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
    test('an arriving action line keeps its emote flag', () => {
      const state = makeState({ activated: true, atBottom: true })

      const result = whisperReducer(state, {
        type: '@whispers/updateMessage',
        payload: {
          action: 'message',
          message: { ...serverMessage(500), emote: true },
          users: [],
          mentions: [],
          channelMentions: [],
        },
        meta: { target: TARGET_ID, isSelfMessage: false, windowFocused: true },
      })

      expect(sessionOf(result).messages[0]).toMatchObject({ emote: true })
    })

    test('an arriving action line keeps its outcome', () => {
      const state = makeState({ activated: true, atBottom: true })

      const result = whisperReducer(state, {
        type: '@whispers/updateMessage',
        payload: {
          action: 'message',
          message: {
            ...serverMessage(500),
            emote: true,
            outcome: { kind: 'roll', max: 100, value: 42 },
          },
          users: [],
          mentions: [],
          channelMentions: [],
        },
        meta: { target: TARGET_ID, isSelfMessage: false, windowFocused: true },
      })

      expect(sessionOf(result).messages[0]).toMatchObject({
        outcome: { kind: 'roll', max: 100, value: 42 },
      })
    })

    test('an ordinary message carries no outcome', () => {
      const state = makeState({ activated: true, atBottom: true })

      const result = whisperReducer(state, updateMessageAction(500))

      expect(sessionOf(result).messages[0]).not.toHaveProperty('outcome')
    })

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

    test('a message arriving at the bottom of an unfocused window counts as unseen', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(200, false))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(true)
      expect(session.unreadLine?.time).toBe(100)
      expect(session.lastReadTime).toBe(100)
    })

    test('a message arriving at the bottom of a focused window is read on arrival', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(200, true))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(false)
      expect(session.unreadLine).toBeUndefined()
      expect(session.lastReadTime).toBe(200)
    })

    test('a message read on arrival does not regress the read position', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 300 })

      const result = whisperReducer(state, updateMessageAction(200, true))

      expect(sessionOf(result).lastReadTime).toBe(300)
    })

    test('a message arriving while scrolled up in an unfocused window raises both', () => {
      const state = makeState({ activated: true, atBottom: false, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(200, false))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(true)
      expect(session.unreadLine?.time).toBe(100)
    })

    test('a message arriving while scrolled up in a focused window raises both', () => {
      const state = makeState({ activated: true, atBottom: false, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(200, true))

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(true)
      expect(session.unreadLine?.time).toBe(100)
      expect(session.lastReadTime).toBe(100)
    })

    test('a message arriving in a session that is not being viewed raises the unread flag', () => {
      const state = makeState({ activated: false, lastReadTime: 100 })

      const result = whisperReducer(state, updateMessageAction(200, true))

      expect(sessionOf(result).hasUnread).toBe(true)
    })

    test.each([
      ['a stale bottom report', { activated: true, atBottom: false, lastReadTime: 100 }, true],
      ['an unfocused window', { activated: true, atBottom: true, lastReadTime: 100 }, false],
      ['an inactive session', { activated: false, lastReadTime: 100 }, true],
    ])('an own echo does not create unread state with %s', (_, stateOverrides, windowFocused) => {
      const result = whisperReducer(
        makeState(stateOverrides),
        updateMessageAction(200, windowFocused, true),
      )

      const session = sessionOf(result)
      expect(messageIdsOf(result)).toEqual(['text-200'])
      expect(session.hasUnread).toBe(false)
      expect(session.unreadLine).toBeUndefined()
    })

    test('an own echo drops the divider and reads the session through the echoed message', () => {
      const result = whisperReducer(
        makeState({ unread: true, unreadLineTime: 100, lastReadTime: 100 }),
        updateMessageAction(200, true, true),
      )

      const session = sessionOf(result)
      expect(session.hasUnread).toBe(false)
      expect(session.unreadLine).toBeUndefined()
      expect(session.lastReadTime).toBe(200)
    })

    test('an own echo does not regress the read position', () => {
      const result = whisperReducer(
        makeState({ unread: true, unreadLineTime: 100, lastReadTime: 300 }),
        updateMessageAction(200, true, true),
      )

      const session = sessionOf(result)
      expect(session.lastReadTime).toBe(300)
      expect(session.unreadLine).toBeUndefined()
      expect(session.hasUnread).toBe(false)
    })

    test('an own echo drops a divider the read position has not passed', () => {
      const result = whisperReducer(
        makeState({
          activated: true,
          atBottom: false,
          unread: true,
          unreadLineTime: 100,
          lastReadTime: 100,
          messages: [textMessage(150)],
        }),
        updateMessageAction(200, true, true),
      )

      const session = sessionOf(result)
      expect(session.unreadLine).toBeUndefined()
      expect(session.hasUnread).toBe(false)
      expect(session.lastReadTime).toBe(200)
    })

    test('an own echo in a session that is not being viewed still reads it', () => {
      const result = whisperReducer(
        makeState({ activated: false, unread: true, unreadLineTime: 100, lastReadTime: 100 }),
        updateMessageAction(200, true, true),
      )

      const session = sessionOf(result)
      expect(session.unreadLine).toBeUndefined()
      expect(session.hasUnread).toBe(false)
      expect(session.lastReadTime).toBe(200)
    })

    test('an own echo past a detached window still tracks the newest time', () => {
      const result = whisperReducer(
        makeState({ hasNewer: true, activated: true, atBottom: true, lastReadTime: 100 }),
        updateMessageAction(200, true, true),
      )

      const session = sessionOf(result)
      expect(messageIdsOf(result)).toEqual([])
      expect(session.detachedNewestTime).toBe(200)
      expect(session.hasUnread).toBe(false)
      expect(session.unreadLine).toBeUndefined()
      expect(session.lastReadTime).toBe(200)
    })

    test('a message arriving in an unfocused window re-freezes a divider the read position has passed', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        unreadLineTime: 100,
        lastReadTime: 200,
        messages: [textMessage(150), textMessage(200)],
      })

      const result = whisperReducer(state, updateMessageAction(300, false))

      const session = sessionOf(result)
      expect(session.unreadLine?.time).toBe(200)
      expect(session.hasUnread).toBe(true)
      expect(session.lastReadTime).toBe(200)
    })

    test('a message arriving while scrolled up re-freezes a divider the read position has passed', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        lastReadTime: 200,
        messages: [textMessage(150), textMessage(200)],
      })

      const result = whisperReducer(state, updateMessageAction(300, true))

      expect(sessionOf(result).unreadLine?.time).toBe(200)
    })

    test('a re-frozen divider is a new divider the user has not looked at yet', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineSeen: true,
        unreadLineLeftBottom: true,
        lastReadTime: 200,
        messages: [textMessage(150), textMessage(200)],
      })

      const result = whisperReducer(state, updateMessageAction(300, true))

      expect(sessionOf(result).unreadLine).toEqual({ time: 200, seen: false, leftBottom: true })
    })

    test('a message arriving while scrolled up keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        lastReadTime: 100,
      })

      const result = whisperReducer(state, updateMessageAction(300, true))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('a message arriving while unfocused keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        unreadLineTime: 100,
        lastReadTime: 100,
      })

      const result = whisperReducer(state, updateMessageAction(300, false))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('a message arriving in a session that is not being viewed does not re-freeze a passed divider', () => {
      const state = makeState({ activated: false, unreadLineTime: 100, lastReadTime: 200 })

      const result = whisperReducer(state, updateMessageAction(300, true))

      const session = sessionOf(result)
      expect(session.unreadLine?.time).toBe(100)
      expect(session.hasUnread).toBe(true)
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

    test('a failed page records an error for the newer edge', () => {
      const state = makeState({ hasNewer: true, loadingNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(state, asFailure(loadNewerMessagesAction(historyResponse([]))))

      expect(sessionOf(result).newerError).toBe(true)
    })

    test('requesting the newer edge again clears its error', () => {
      const state = makeState({ hasNewer: true, newerError: true, messages: [textMessage(100)] })

      const result = whisperReducer(state, loadNewerMessagesBeginAction({ afterTime: 100 }))

      expect(sessionOf(result).newerError).toBe(false)
    })

    test('a page that lands clears a newer edge error an earlier request left behind', () => {
      const state = makeState({
        hasNewer: true,
        newerError: true,
        loadingNewer: true,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(
        state,
        loadNewerMessagesAction(historyResponse([serverMessage(200)]), { afterTime: 100 }),
      )

      expect(sessionOf(result).newerError).toBe(false)
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

    test('clears both edge errors along with the window they belonged to', () => {
      const state = makeState({
        messages: [textMessage(100)],
        historyError: { kind: 'history' },
        newerError: true,
      })

      const result = whisperReducer(state, resetMessageWindowAction())

      expect(sessionOf(result).historyError).toBeUndefined()
      expect(sessionOf(result).newerError).toBe(false)
    })
  })

  describe('@whispers/activateWhisperSession', () => {
    test('freezes the divider at the read position when the session has unread messages', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      const session = sessionOf(result)
      expect(session.unreadLine?.time).toBe(100)
      expect(session.activated).toBe(true)
    })

    test('keeps the unread flag until the read report covers the newest message', () => {
      const state = makeState({
        unread: true,
        atBottom: true,
        lastReadTime: 100,
        messages: [textMessage(200)],
      })

      const activated = whisperReducer(state, activateSessionAction())
      expect(sessionOf(activated).hasUnread).toBe(true)

      const read = whisperReducer(activated, updateLastReadTimeAction(200))
      expect(sessionOf(read).hasUnread).toBe(false)
    })

    test('keeps the unread flag when the view opens on a read report short of the newest', () => {
      const state = makeState({
        unread: true,
        atBottom: false,
        lastReadTime: 100,
        messages: [textMessage(200)],
      })

      const activated = whisperReducer(state, activateSessionAction())
      const read = whisperReducer(activated, updateLastReadTimeAction(150))

      expect(sessionOf(read).hasUnread).toBe(true)
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

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('keeps a divider the read position has passed when opening away from the bottom', () => {
      const state = makeState({ lastReadTime: 200, unreadLineTime: 100 })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({ lastReadTime: 100, unreadLineTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider frozen by this activation', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('a divider frozen at the bottom has no trip away from it behind it', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: true })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLine).toEqual({ time: 100, seen: false, leftBottom: false })
    })

    test('a divider frozen away from the bottom counts as one the view has left', () => {
      const state = makeState({ unread: true, lastReadTime: 100, atBottom: false })

      const result = whisperReducer(state, activateSessionAction())

      expect(sessionOf(result).unreadLine).toEqual({ time: 100, seen: false, leftBottom: true })
    })
  })

  describe('@whispers/deactivateWhisperSession', () => {
    test('clears both edge errors so the next visit makes a fresh attempt', () => {
      const state = makeState({
        activated: true,
        messages: [textMessage(100)],
        historyError: { kind: 'history' },
        newerError: true,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).historyError).toBeUndefined()
      expect(sessionOf(result).newerError).toBe(false)
    })

    test('consumes a divider the read position has passed when left at the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('keeps a divider the read position has passed when left away from the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        lastReadTime: 200,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 100,
        unreadLineTime: 100,
      })

      const result = whisperReducer(state, deactivateSessionAction())

      expect(sessionOf(result).unreadLine?.time).toBe(100)
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

      expect(sessionOf(result).unreadLine?.time).toBe(100)
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

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).messages.length).toBe(150)
    })

    test('defers the trim while an older page is in flight, keeping the window it was fetched for', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      const state = makeState({ activated: true, loadingHistory: true, messages })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).messages.length).toBe(200)
      expect(sessionOf(result).windowGen).toBe(0)
    })

    test('a page in flight lands contiguously on the window it was fetched for', () => {
      const messages = Array.from({ length: 200 }, (_, i) => textMessage(i + 1))
      let result = whisperReducer(
        makeState({ activated: true, loadingHistory: true, messages }),
        updateSessionAtBottomAction(true),
      )
      // Scrolling away again before the page lands leaves nothing to trim the seam afterwards, so
      // a window trimmed past the page's boundary would keep the gap for as long as it's loaded.
      result = whisperReducer(result, updateSessionAtBottomAction(false))
      result = whisperReducer(
        result,
        loadMessageHistoryAction(historyResponse([serverMessage(0)]), { beforeTime: 1 }),
      )

      expect(messageIdsOf(result)).toEqual(['text-0', ...messages.map(m => m.id)])
    })

    test('a report from away from the bottom records that the view left it', () => {
      const state = makeState({ activated: true, atBottom: true, unreadLineTime: 100 })

      const result = whisperReducer(state, updateSessionAtBottomAction(false))

      expect(sessionOf(result).unreadLine?.leftBottom).toBe(true)
    })

    test('drops a divider the user looked at when the view returns to the bottom past it', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineSeen: true,
        unreadLineLeftBottom: true,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('keeps a divider the user never looked at when the view returns to the bottom', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineLeftBottom: true,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider the read position has not passed', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineSeen: true,
        unreadLineLeftBottom: true,
        lastReadTime: 100,
      })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider on a view that arrives at the bottom without having left it', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        unreadLineTime: 100,
        unreadLineSeen: true,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('keeps a divider at the loaded bottom of a window detached from the present', () => {
      const state = makeState({
        activated: true,
        atBottom: false,
        hasNewer: true,
        unreadLineTime: 100,
        unreadLineSeen: true,
        unreadLineLeftBottom: true,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, updateSessionAtBottomAction(true))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })

    test('a mount/cleanup/remount cycle at the bottom leaves the divider where it is', () => {
      // The cycle React's StrictMode runs in development, where the list arrives at the bottom with
      // the divider on screen every time and the read report follows it there. The user never
      // scrolled away from where they left off, so the divider still marks it.
      let result = whisperReducer(
        makeState({
          unread: true,
          atBottom: true,
          lastReadTime: 100,
          messages: [textMessage(200)],
        }),
        activateSessionAction(),
      )
      result = whisperReducer(result, unreadLineSeenAction(100))
      result = whisperReducer(result, deactivateSessionAction())
      result = whisperReducer(result, updateSessionAtBottomAction(true))
      result = whisperReducer(result, activateSessionAction())
      result = whisperReducer(result, updateLastReadTimeAction(200))

      expect(sessionOf(result).unreadLine?.time).toBe(100)
    })
  })

  describe('@whispers/unreadLineSeen', () => {
    test('records that the divider has been in view', () => {
      const state = makeState({ activated: true, atBottom: false, unreadLineTime: 100 })

      const result = whisperReducer(state, unreadLineSeenAction(100))

      expect(sessionOf(result).unreadLine?.seen).toBe(true)
    })

    test('ignores a report for a time the divider no longer sits at', () => {
      const state = makeState({ activated: true, atBottom: false, unreadLineTime: 200 })

      const result = whisperReducer(state, unreadLineSeenAction(100))

      expect(sessionOf(result).unreadLine?.seen).toBe(false)
    })

    test('drops a divider the view is already back at the bottom of', () => {
      // A jump straight to the bottom from above the divider lands with it still on screen, and the
      // view reports where it ended up before it reports what's in the viewport.
      const state = makeState({
        activated: true,
        atBottom: true,
        unreadLineTime: 100,
        unreadLineLeftBottom: true,
        lastReadTime: 200,
      })

      const result = whisperReducer(state, unreadLineSeenAction(100))

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('does nothing for a session with no divider', () => {
      const state = makeState({ activated: true, atBottom: true, lastReadTime: 200 })

      const result = whisperReducer(state, unreadLineSeenAction(100))

      expect(sessionOf(result).unreadLine).toBeUndefined()
    })

    test('does nothing for a session that is not open', () => {
      const state = makeState({ activated: true, atBottom: true, unreadLineTime: 100 })

      const result = whisperReducer(state, unreadLineSeenAction(100, OTHER_ID))

      expect(sessionOf(result).unreadLine?.seen).toBe(false)
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

  describe('@messaging/appendLocalMessage', () => {
    test('appends to an attached window without touching unread state', () => {
      const state = makeState({
        activated: true,
        atBottom: true,
        lastReadTime: 100,
        messages: [textMessage(100)],
      })

      const result = whisperReducer(state, appendLocalMessageAction(echoMessage('echo', 200)))

      expect(messageIdsOf(result)).toEqual(['text-100', 'echo'])
      expect(sessionOf(result).hasUnread).toBe(false)
      expect(sessionOf(result).lastReadTime).toBe(100)
    })

    test('a detached window carries the message instead of appending it', () => {
      const state = makeState({ hasNewer: true, messages: [textMessage(100)] })

      const result = whisperReducer(state, appendLocalMessageAction(echoMessage('echo', 200)))

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(sessionOf(result).carriedClientMessages.map(m => m.id)).toEqual(['echo'])
      expect(sessionOf(result).hasUnread).toBe(false)
    })

    test('a message carried while detached comes back once the window reattaches', () => {
      let result = whisperReducer(
        makeState({ hasNewer: true, messages: [textMessage(100)] }),
        appendLocalMessageAction(echoMessage('echo', 200)),
      )

      result = whisperReducer(
        result,
        loadNewerMessagesAction(historyResponse([serverMessage(300)], { hasMoreAfter: false }), {
          afterTime: 100,
          knownNewestTime: 100,
        }),
      )

      expect(sessionOf(result).hasNewer).toBe(false)
      expect(messageIdsOf(result)).toEqual(['text-100', 'echo', 'text-300'])
      expect(sessionOf(result).carriedClientMessages).toEqual([])
    })

    test('a message for a session this client has no state for is dropped', () => {
      const state = makeState({ messages: [textMessage(100)] })

      const result = whisperReducer(state, {
        type: '@messaging/appendLocalMessage',
        payload: {
          target: { surface: 'whisper', userId: OTHER_ID },
          message: echoMessage('echo', 200),
        },
      })

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(sessionOf(result).carriedClientMessages).toEqual([])
    })

    test('a message for another kind of surface is left to that surface', () => {
      const state = makeState({ messages: [textMessage(100)] })

      const result = whisperReducer(state, {
        type: '@messaging/appendLocalMessage',
        payload: { target: { surface: 'lobby' }, message: echoMessage('echo', 200) },
      })

      expect(messageIdsOf(result)).toEqual(['text-100'])
      expect(sessionOf(result).carriedClientMessages).toEqual([])
    })

    test('the inactive-session trim cuts it like any other message', () => {
      const messages = Array.from({ length: 150 }, (_, i) => textMessage(i + 1))
      let result = whisperReducer(
        makeState({ activated: true, messages }),
        appendLocalMessageAction(echoMessage('echo', 200)),
      )
      expect(messageIdsOf(result)).toHaveLength(151)

      result = whisperReducer(result, deactivateSessionAction())

      expect(messageIdsOf(result)).toHaveLength(150)
      expect(messageIdsOf(result)).toContain('echo')
      expect(messageIdsOf(result)).not.toContain('text-1')
      expect(sessionOf(result).carriedClientMessages).toEqual([])
    })
  })

  describe('carried client-only messages', () => {
    test('a dropped window carries them, and a covering window gives them back', () => {
      const echo = echoMessage('echo', 200)
      let result = whisperReducer(
        makeState({ messages: [textMessage(100), textMessage(300)] }),
        appendLocalMessageAction(echo),
      )
      expect(messageIdsOf(result)).toEqual(['text-100', 'text-300', 'echo'])

      result = whisperReducer(result, resetMessageWindowAction())
      expect(messageIdsOf(result)).toEqual([])
      expect(sessionOf(result).carriedClientMessages.map(m => m.id)).toEqual(['echo'])

      result = whisperReducer(
        result,
        loadMessageHistoryAction(historyResponse([serverMessage(100), serverMessage(300)]), {
          windowGen: 1,
        }),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'echo', 'text-300'])
      expect(sessionOf(result).carriedClientMessages).toEqual([])
    })

    test('a window that does not cover their time keeps them carried', () => {
      let result = whisperReducer(
        makeState({ messages: [textMessage(500)] }),
        appendLocalMessageAction(echoMessage('echo', 500)),
      )

      result = whisperReducer(result, resetMessageWindowAction())
      result = whisperReducer(
        result,
        loadMessagesAroundAction(
          historyResponse([serverMessage(100), serverMessage(200)], {
            hasMoreBefore: true,
            hasMoreAfter: true,
          }),
          { windowGen: 1, aroundTime: 150 },
        ),
      )

      expect(messageIdsOf(result)).toEqual(['text-100', 'text-200'])
      expect(sessionOf(result).carriedClientMessages.map(m => m.id)).toEqual(['echo'])
    })

    test('evicts the oldest carried message once the cap is exceeded', () => {
      const existingCarried = Array.from({ length: 50 }, (_, i) => echoMessage(`old-${i}`, i + 1))
      const state = makeState({
        carriedClientMessages: existingCarried,
        hasNewer: true,
        messages: [textMessage(500)],
      })

      const result = whisperReducer(state, appendLocalMessageAction(echoMessage('newest', 1000)))

      const carried = sessionOf(result).carriedClientMessages
      expect(carried.length).toBe(50)
      expect(carried.map(m => m.id)).not.toContain('old-0')
      expect(carried.map(m => m.id)).toContain('newest')
    })
  })

  describe('hasAttentionWorthyWhisper', () => {
    test('an unread whisper needs attention', () => {
      expect(hasAttentionWorthyWhisper(makeState({ unread: true }), new Map())).toBe(true)
    })

    test("a blocked user's unread whisper doesn't need attention", () => {
      expect(
        hasAttentionWorthyWhisper(makeState({ unread: true }), new Map([[TARGET_ID, {}]])),
      ).toBe(false)
    })

    test('blocking a different user leaves an unread whisper needing attention', () => {
      expect(
        hasAttentionWorthyWhisper(makeState({ unread: true }), new Map([[OTHER_ID, {}]])),
      ).toBe(true)
    })

    test("a read whisper doesn't need attention", () => {
      expect(hasAttentionWorthyWhisper(makeState(), new Map())).toBe(false)
    })
  })
})
