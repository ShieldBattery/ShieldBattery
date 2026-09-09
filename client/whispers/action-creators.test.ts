import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { DispatchFunction } from '../dispatch-registry'
import { LastReadSender, reportLastRead } from '../messaging/last-read'
import { CommonMessageType, CommonTextMessage } from '../messaging/message-records'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import { markWhisperRead, markWhisperReadNow } from './action-creators'

vi.mock('../network/fetch', () => ({
  fetchJson: vi.fn(),
  encodeBodyAsParams: vi.fn(() => ''),
}))

vi.mock('../messaging/last-read', () => ({
  reportLastRead: vi.fn(),
  flushLastRead: vi.fn(),
}))

vi.mock('../logging/logger', () => ({
  default: {
    verbose: vi.fn(),
    debug: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
}))

const fetchJsonMock = asMockedFunction(fetchJson)
const reportLastReadMock = asMockedFunction(reportLastRead)

const TARGET_ID = makeSbUserId(7)
const LAST_READ_TIME = 1234

/**
 * Runs the `markWhisperRead` thunk and hands back what it dispatched plus the sender the coalescer
 * would call when the report actually goes out.
 */
function runMarkRead(lastReadTime = LAST_READ_TIME) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>

  markWhisperRead(TARGET_ID, lastReadTime)(dispatch, (() => ({})) as () => RootState)

  const send = reportLastReadMock.mock.calls.at(-1)![2] as LastReadSender
  return { dispatched, send }
}

describe('client/whispers/action-creators/markWhisperRead', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    reportLastReadMock.mockReset()
  })

  test('advances the local read position immediately', () => {
    fetchJsonMock.mockResolvedValue(undefined)

    const { dispatched } = runMarkRead()

    expect(dispatched).toEqual([
      {
        type: '@whispers/updateLastReadTime',
        payload: { targetId: TARGET_ID, lastReadTime: LAST_READ_TIME },
      },
    ])
    expect(reportLastReadMock).toHaveBeenCalledWith(
      expect.any(String),
      LAST_READ_TIME,
      expect.any(Function),
    )
  })

  test('resolves the send when the request succeeds', async () => {
    fetchJsonMock.mockResolvedValue(undefined)

    const { send } = runMarkRead()

    await expect(send(LAST_READ_TIME)).resolves.toBeUndefined()
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
  })

  test('rejects the send with the fetch error so the report can be retried', async () => {
    const error = new Error('network go boom')
    fetchJsonMock.mockRejectedValue(error)

    const { send } = runMarkRead()

    await expect(send(LAST_READ_TIME)).rejects.toBe(error)
  })
})

const NOW = 5_000_000

function textMessage(time: number): CommonTextMessage {
  return {
    id: `text-${time}`,
    type: CommonMessageType.TextMessage,
    time,
    from: TARGET_ID,
    text: 'hello',
  }
}

/** A `RootState` carrying just the whisper slice `markWhisperReadNow` reads. */
function makeReadPositionState(messages: CommonTextMessage[]): RootState {
  const session = {
    target: TARGET_ID,
    messages,
    loadingHistory: false,
    hasHistory: true,
    loadingNewer: false,
    hasNewer: false,
    detachedNewestTime: undefined,
    windowGen: 0,
    activated: false,
    atBottom: false,
    hasUnread: false,
  }
  const whispers = { sessions: new Set([TARGET_ID]), byId: new Map([[TARGET_ID, session]]) }
  return { whispers } as unknown as RootState
}

/** Runs the `markWhisperReadNow` thunk against `state` and hands back what it dispatched. */
function runMarkReadNow(state: RootState) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>

  markWhisperReadNow(TARGET_ID)(dispatch, () => state)

  return { dispatched }
}

describe('client/whispers/action-creators/markWhisperReadNow', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    reportLastReadMock.mockReset()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('marks read as of now when nothing known is newer', () => {
    const { dispatched } = runMarkReadNow(makeReadPositionState([textMessage(NOW - 100)]))

    expect(dispatched).toEqual([
      {
        type: '@whispers/updateLastReadTime',
        payload: { targetId: TARGET_ID, lastReadTime: NOW, dismissUnreadLine: true },
      },
    ])
    expect(reportLastReadMock).toHaveBeenCalledWith(expect.any(String), NOW, expect.any(Function))
  })

  test('reports a known time that has run ahead of the local clock', () => {
    const newerTime = NOW + 5000
    const { dispatched } = runMarkReadNow(makeReadPositionState([textMessage(newerTime)]))

    expect(dispatched).toEqual([
      {
        type: '@whispers/updateLastReadTime',
        payload: { targetId: TARGET_ID, lastReadTime: newerTime, dismissUnreadLine: true },
      },
    ])
    expect(reportLastReadMock).toHaveBeenCalledWith(
      expect.any(String),
      newerTime,
      expect.any(Function),
    )
  })
})
