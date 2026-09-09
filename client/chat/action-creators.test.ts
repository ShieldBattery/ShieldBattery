import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  ChannelPermissions,
  ChannelTextMessage,
  SbChannelId,
  ServerChatMessageType,
  makeSbChannelId,
} from '../../common/chat'
import { asMockedFunction } from '../../common/testing/mocks'
import { SbUserId, makeSbUserId } from '../../common/users/sb-user-id'
import { DispatchFunction } from '../dispatch-registry'
import { LastReadSender, reportLastRead } from '../messaging/last-read'
import { fetchJson } from '../network/fetch'
import { RootState } from '../root-reducer'
import {
  ChannelLeaveSeverity,
  getChannelLeaveSeverity,
  markChannelRead,
  markChannelReadNow,
} from './action-creators'

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

const CHANNEL_ID = makeSbChannelId(1)
const SELF_ID = makeSbUserId(1)
const OTHER_ID = makeSbUserId(2)

const NO_PERMISSIONS: ChannelPermissions = {
  kick: false,
  ban: false,
  changeTopic: false,
  togglePrivate: false,
  editPermissions: false,
}

function makeState({
  official = false,
  userCount,
  ownerId,
  selfPermissions,
}: {
  official?: boolean
  /** When left `undefined`, the detailed channel info is absent entirely (not yet loaded). */
  userCount?: number
  ownerId?: SbUserId
  selfPermissions?: ChannelPermissions
} = {}): RootState {
  const chat = {
    idToBasicInfo: new Map([
      [CHANNEL_ID, { id: CHANNEL_ID, name: 'test', private: false, official }],
    ]),
    idToDetailedInfo: new Map(
      userCount !== undefined ? [[CHANNEL_ID, { id: CHANNEL_ID, userCount }]] : [],
    ),
    idToJoinedInfo: new Map([[CHANNEL_ID, { id: CHANNEL_ID, ownerId }]]),
    idToSelfPermissions: new Map<SbChannelId, ChannelPermissions>(
      selfPermissions ? [[CHANNEL_ID, selfPermissions]] : [],
    ),
  }
  return { chat } as unknown as RootState
}

describe('chat/action-creators/getChannelLeaveSeverity', () => {
  test('returns None when there is nothing at stake', () => {
    const state = makeState({ userCount: 5, ownerId: OTHER_ID, selfPermissions: NO_PERMISSIONS })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(ChannelLeaveSeverity.None)
  })

  test('returns LosePermissions when holding any channel permission', () => {
    const state = makeState({
      userCount: 5,
      ownerId: OTHER_ID,
      selfPermissions: { ...NO_PERMISSIONS, kick: true },
    })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LosePermissions,
    )
  })

  test('returns LoseOwnership for an owner who is not the last member, even with permissions', () => {
    const state = makeState({
      userCount: 5,
      ownerId: SELF_ID,
      selfPermissions: {
        kick: true,
        ban: true,
        changeTopic: true,
        togglePrivate: true,
        editPermissions: true,
      },
    })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LoseOwnership,
    )
  })

  test('returns DeleteChannel for the last member of a non-official channel', () => {
    const state = makeState({ userCount: 1 })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.DeleteChannel,
    )
  })

  test('returns DeleteChannel (not LoseOwnership) for an owner who is also the last member', () => {
    const state = makeState({ userCount: 1, ownerId: SELF_ID })

    expect(getChannelLeaveSeverity(state, CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.DeleteChannel,
    )
  })

  test('never claims deletion when the member count is missing', () => {
    expect(getChannelLeaveSeverity(makeState({ ownerId: SELF_ID }), CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.LoseOwnership,
    )
    expect(getChannelLeaveSeverity(makeState(), CHANNEL_ID, SELF_ID)).toBe(
      ChannelLeaveSeverity.None,
    )
  })

  test('never claims deletion for official channels, falling through to lesser severities', () => {
    expect(
      getChannelLeaveSeverity(makeState({ official: true, userCount: 1 }), CHANNEL_ID, SELF_ID),
    ).toBe(ChannelLeaveSeverity.None)
    expect(
      getChannelLeaveSeverity(
        makeState({
          official: true,
          userCount: 1,
          selfPermissions: { ...NO_PERMISSIONS, changeTopic: true },
        }),
        CHANNEL_ID,
        SELF_ID,
      ),
    ).toBe(ChannelLeaveSeverity.LosePermissions)
  })
})

const fetchJsonMock = asMockedFunction(fetchJson)
const reportLastReadMock = asMockedFunction(reportLastRead)

const LAST_READ_TIME = 1234

/**
 * Runs the `markChannelRead` thunk and hands back what it dispatched plus the sender the coalescer
 * would call when the report actually goes out.
 */
function runMarkRead(lastReadTime = LAST_READ_TIME) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>

  markChannelRead(CHANNEL_ID, lastReadTime)(dispatch, (() => ({})) as () => RootState)

  const send = reportLastReadMock.mock.calls.at(-1)![2] as LastReadSender
  return { dispatched, send }
}

describe('chat/action-creators/markChannelRead', () => {
  beforeEach(() => {
    fetchJsonMock.mockReset()
    reportLastReadMock.mockReset()
  })

  test('advances the local read position immediately', () => {
    fetchJsonMock.mockResolvedValue(undefined)

    const { dispatched } = runMarkRead()

    expect(dispatched).toEqual([
      {
        type: '@chat/updateLastReadTime',
        payload: { channelId: CHANNEL_ID, lastReadTime: LAST_READ_TIME },
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

/** A `RootState` carrying just the chat slice `markChannelReadNow` reads. */
function makeReadPositionState({
  messages = [],
  latestMentionTime,
}: {
  messages?: ChannelTextMessage[]
  latestMentionTime?: number
} = {}): RootState {
  const chat = {
    idToMessages: new Map([
      [
        CHANNEL_ID,
        {
          messages,
          carriedClientMessages: [],
          loadingHistory: false,
          hasHistory: true,
          loadingNewer: false,
          hasNewer: false,
          detachedNewestTime: undefined,
          windowGen: 0,
        },
      ],
    ]),
    idToLatestMentionTime: new Map(
      latestMentionTime !== undefined ? [[CHANNEL_ID, latestMentionTime]] : [],
    ),
  }
  return { chat } as unknown as RootState
}

function textMessage(time: number): ChannelTextMessage {
  return {
    id: `text-${time}`,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time,
    from: OTHER_ID,
    text: 'hello',
  }
}

/** Runs the `markChannelReadNow` thunk against `state` and hands back what it dispatched. */
function runMarkReadNow(state: RootState) {
  const dispatched: unknown[] = []
  const dispatch = ((action: unknown) => {
    dispatched.push(action)
  }) as DispatchFunction<any>

  markChannelReadNow(CHANNEL_ID)(dispatch, () => state)

  return { dispatched }
}

describe('chat/action-creators/markChannelReadNow', () => {
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
    const { dispatched } = runMarkReadNow(
      makeReadPositionState({ messages: [textMessage(NOW - 100)] }),
    )

    expect(dispatched).toEqual([
      {
        type: '@chat/updateLastReadTime',
        payload: { channelId: CHANNEL_ID, lastReadTime: NOW, dismissUnreadLine: true },
      },
    ])
    expect(reportLastReadMock).toHaveBeenCalledWith(expect.any(String), NOW, expect.any(Function))
  })

  test('reports a known time that has run ahead of the local clock', () => {
    const newerTime = NOW + 5000
    const { dispatched } = runMarkReadNow(
      makeReadPositionState({ messages: [textMessage(newerTime)], latestMentionTime: NOW - 100 }),
    )

    expect(dispatched).toEqual([
      {
        type: '@chat/updateLastReadTime',
        payload: { channelId: CHANNEL_ID, lastReadTime: newerTime, dismissUnreadLine: true },
      },
    ])
    expect(reportLastReadMock).toHaveBeenCalledWith(
      expect.any(String),
      newerTime,
      expect.any(Function),
    )
  })
})
