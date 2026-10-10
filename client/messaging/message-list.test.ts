import { describe, expect, test } from 'vitest'
import {
  type ChannelTextMessage,
  type ChatMessage,
  ClientChatMessageType,
  makeSbChannelId,
  ServerChatMessageType,
} from '../../common/chat'
import { UserRelationshipJson } from '../../common/users/relationships'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import {
  CHAT_GROUPING_WINDOW_MS,
  type CozyGroupTail,
  cozyLayoutFor,
  findUnreadLineIndex,
  isScrolledToBottom,
  layoutMessageList,
} from './message-list'
import { CommonMessageType, type CommonTextMessage, type SbMessage } from './message-records'

const CHANNEL_ID = makeSbChannelId(1)
const USER_ID = makeSbUserId(2)

/** A channel text message, which the server persists and stamps with its own clock. */
function channelText(id: string, time: number): ChatMessage {
  return {
    id,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time,
    from: USER_ID,
    text: 'hi',
  }
}

/** A channel join banner, which is only ever generated on the client. */
function clientLeave(id: string, time: number): ChatMessage {
  return {
    id,
    type: ClientChatMessageType.LeaveChannel,
    channelId: CHANNEL_ID,
    time,
    userId: USER_ID,
  }
}

/** How whisper messages are stored once received from the server. */
function whisperText(id: string, time: number): CommonTextMessage {
  return {
    id,
    type: CommonMessageType.TextMessage,
    time,
    from: USER_ID,
    text: 'hi',
  }
}

/** `isScrolledToBottom` only reads the scroll geometry, so a bare object stands in for the node. */
function scroller(scrollTop: number, clientHeight: number, scrollHeight: number): HTMLElement {
  return { scrollTop, clientHeight, scrollHeight } as HTMLElement
}

describe('client/messaging/message-list/findUnreadLineIndex', () => {
  test('no messages', () => {
    expect(findUnreadLineIndex([], 1000, false)).toBe(-1)
  })

  test('no read position means no divider', () => {
    expect(
      findUnreadLineIndex([channelText('a', 1000), channelText('b', 2000)], undefined, false),
    ).toBe(-1)
  })

  test('everything already read', () => {
    const messages = [channelText('a', 1000), channelText('b', 2000)]

    expect(findUnreadLineIndex(messages, 3000, false)).toBe(-1)
  })

  test('divider goes in front of the first message newer than the read position', () => {
    const messages = [
      channelText('a', 1000),
      channelText('b', 2000),
      channelText('c', 3000),
      channelText('d', 4000),
    ]

    expect(findUnreadLineIndex(messages, 2000, false)).toBe(2)
  })

  test('a message exactly at the read position has been read', () => {
    const messages = [channelText('a', 1000), channelText('b', 2000), channelText('c', 2001)]

    expect(findUnreadLineIndex(messages, 2000, false)).toBe(2)
  })

  test('everything unread with no more history puts the divider in front of the first message', () => {
    const messages = [channelText('a', 1000), channelText('b', 2000)]

    expect(findUnreadLineIndex(messages, 500, false)).toBe(0)
  })

  test('everything unread with more history means the boundary is not loaded yet', () => {
    const messages = [channelText('a', 1000), channelText('b', 2000)]

    expect(findUnreadLineIndex(messages, 500, true)).toBe(-1)
  })

  test('a read message in the window anchors the divider even with more history', () => {
    const messages = [channelText('a', 1000), channelText('b', 2000)]

    expect(findUnreadLineIndex(messages, 1000, true)).toBe(1)
  })

  test('a leading client-only message is not evidence the boundary is loaded', () => {
    const messages = [clientLeave('a', 900), channelText('b', 1000), channelText('c', 2000)]

    expect(findUnreadLineIndex(messages, 500, true)).toBe(-1)
  })

  test('client-only messages are skipped', () => {
    const messages = [
      channelText('a', 1000),
      // Stamped with the local clock, so its time means nothing next to a server read position.
      clientLeave('b', 2000),
      channelText('c', 3000),
    ]

    expect(findUnreadLineIndex(messages, 1500, false)).toBe(2)
  })

  test('a list of only client-only messages never gets a divider', () => {
    const messages = [clientLeave('a', 2000), clientLeave('b', 3000)]

    expect(findUnreadLineIndex(messages, 1000, false)).toBe(-1)
  })

  test('whisper messages count as server-origin', () => {
    const messages: SbMessage[] = [whisperText('a', 1000), whisperText('b', 2000)]

    expect(findUnreadLineIndex(messages, 1000, false)).toBe(1)
  })

  test('a join message can hold the divider position', () => {
    const messages: SbMessage[] = [
      channelText('a', 1000),
      {
        id: 'b',
        type: ServerChatMessageType.JoinChannel,
        channelId: CHANNEL_ID,
        time: 2000,
        userId: USER_ID,
      },
      channelText('c', 3000),
    ]

    expect(findUnreadLineIndex(messages, 1000, false)).toBe(1)
  })
})

describe('client/messaging/message-list/isScrolledToBottom', () => {
  test('exactly at the bottom', () => {
    expect(isScrolledToBottom(scroller(900, 100, 1000))).toBe(true)
  })

  test('a fractional offset short of the bottom is within the leeway', () => {
    expect(isScrolledToBottom(scroller(99.5, 400, 500))).toBe(true)
  })

  test('the far edge of the leeway still counts as the bottom', () => {
    expect(isScrolledToBottom(scroller(892, 100, 1000))).toBe(true)
  })

  test('one pixel past the leeway is not the bottom', () => {
    expect(isScrolledToBottom(scroller(891, 100, 1000))).toBe(false)
  })

  test('a fraction past the leeway is not the bottom', () => {
    expect(isScrolledToBottom(scroller(891.5, 100, 1000))).toBe(false)
  })

  test('far from the bottom', () => {
    expect(isScrolledToBottom(scroller(0, 100, 1000))).toBe(false)
  })

  test('content that fits without scrolling is at the bottom', () => {
    expect(isScrolledToBottom(scroller(0, 500, 500))).toBe(true)
  })
})

describe('client/messaging/message-list/cozyLayoutFor', () => {
  const OTHER_USER_ID = makeSbUserId(3)
  const NO_BLOCKS = new Map<SbUserId, UserRelationshipJson>()

  function textFrom(
    from: SbUserId,
    time: number,
    extra: Pick<ChannelTextMessage, 'emote' | 'outcome'> = {},
  ): ChannelTextMessage {
    return {
      id: `m-${time}`,
      type: ServerChatMessageType.TextMessage,
      channelId: CHANNEL_ID,
      time,
      from,
      text: 'hi',
      ...extra,
    }
  }

  /** Runs `cozyLayoutFor` over a list the way the message list does, with no dividers. */
  function layoutsOf(
    messages: ReadonlyArray<SbMessage>,
    blocks: ReadonlyMap<SbUserId, UserRelationshipJson> = NO_BLOCKS,
    dividerBeforeIndex = -1,
  ) {
    let prev: CozyGroupTail | undefined
    return messages.map((m, i) => {
      const { layout, next } = cozyLayoutFor(m, prev, i === dividerBeforeIndex, blocks)
      prev = next
      return layout
    })
  }

  test('same author within the window continues the group', () => {
    expect(
      layoutsOf([
        textFrom(USER_ID, 0),
        textFrom(USER_ID, 30_000),
        textFrom(USER_ID, 30_000 + CHAT_GROUPING_WINDOW_MS),
      ]),
    ).toEqual(['cozyHeader', 'cozyContinuation', 'cozyContinuation'])
  })

  test('same author beyond the window starts a new group', () => {
    expect(
      layoutsOf([textFrom(USER_ID, 0), textFrom(USER_ID, CHAT_GROUPING_WINDOW_MS + 1)]),
    ).toEqual(['cozyHeader', 'cozyHeader'])
  })

  test('a different author starts a new group', () => {
    expect(
      layoutsOf([textFrom(USER_ID, 0), textFrom(OTHER_USER_ID, 1000), textFrom(USER_ID, 2000)]),
    ).toEqual(['cozyHeader', 'cozyHeader', 'cozyHeader'])
  })

  test('an emote line gets no cozy layout and breaks the group', () => {
    expect(
      layoutsOf([
        textFrom(USER_ID, 0),
        textFrom(USER_ID, 1000, { emote: true }),
        textFrom(USER_ID, 2000),
      ]),
    ).toEqual(['cozyHeader', undefined, 'cozyHeader'])
  })

  test('an outcome line gets no cozy layout and breaks the group', () => {
    expect(
      layoutsOf([
        textFrom(USER_ID, 0),
        textFrom(USER_ID, 1000, { emote: true, outcome: { kind: 'flip', result: 'heads' } }),
        textFrom(USER_ID, 2000),
      ]),
    ).toEqual(['cozyHeader', undefined, 'cozyHeader'])
  })

  test('a system message breaks the group', () => {
    expect(
      layoutsOf([textFrom(USER_ID, 0), clientLeave('leave', 1000), textFrom(USER_ID, 2000)]),
    ).toEqual(['cozyHeader', undefined, 'cozyHeader'])
  })

  test('a divider before the message starts a new group', () => {
    expect(layoutsOf([textFrom(USER_ID, 0), textFrom(USER_ID, 1000)], NO_BLOCKS, 1)).toEqual([
      'cozyHeader',
      'cozyHeader',
    ])
  })

  test('a blocked author gets no cozy layout and breaks the group', () => {
    const blocks = new Map<SbUserId, UserRelationshipJson>([
      [OTHER_USER_ID, {} as UserRelationshipJson],
    ])

    expect(
      layoutsOf(
        [textFrom(USER_ID, 0), textFrom(OTHER_USER_ID, 1000), textFrom(USER_ID, 2000)],
        blocks,
      ),
    ).toEqual(['cozyHeader', undefined, 'cozyHeader'])
  })

  test('whisper text messages group too', () => {
    expect(layoutsOf([whisperText('a', 0), whisperText('b', 1000)])).toEqual([
      'cozyHeader',
      'cozyContinuation',
    ])
  })
})

describe('client/messaging/message-list/layoutMessageList', () => {
  const BLOCKED_USER_ID = makeSbUserId(4)
  const BLOCKS = new Map<SbUserId, UserRelationshipJson>([
    [BLOCKED_USER_ID, {} as UserRelationshipJson],
  ])
  const DAY_MS = 24 * 60 * 60 * 1000
  // Noon local time, so a day either side stays on a different calendar day in any time zone.
  const DAY_ONE = new Date(2026, 0, 1, 12).getTime()

  function textFrom(id: string, from: SbUserId, time: number): ChannelTextMessage {
    return {
      id,
      type: ServerChatMessageType.TextMessage,
      channelId: CHANNEL_ID,
      time,
      from,
      text: 'hi',
    }
  }

  function layout(
    messages: ReadonlyArray<SbMessage>,
    {
      unreadLineTime,
      hasMoreHistory = false,
      hideBlocked = true,
      cozy = false,
    }: {
      unreadLineTime?: number
      hasMoreHistory?: boolean
      hideBlocked?: boolean
      cozy?: boolean
    } = {},
  ) {
    return layoutMessageList(messages, {
      unreadLineTime,
      hasMoreHistory,
      blockedUsers: BLOCKS,
      hideBlocked,
      cozy,
    })
  }

  test('blocked messages are left out when hidden', () => {
    const entries = layout([
      textFrom('a', USER_ID, DAY_ONE),
      textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
      textFrom('c', USER_ID, DAY_ONE + 2000),
    ])

    expect(entries.map(e => e.message.id)).toEqual(['a', 'c'])
  })

  test('blocked messages are kept when not hidden', () => {
    const entries = layout(
      [textFrom('a', USER_ID, DAY_ONE), textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000)],
      { hideBlocked: false },
    )

    expect(entries.map(e => e.message.id)).toEqual(['a', 'b'])
  })

  test('only text messages are hidden', () => {
    const entries = layout([
      textFrom('a', USER_ID, DAY_ONE),
      {
        id: 'b',
        type: ServerChatMessageType.JoinChannel,
        channelId: CHANNEL_ID,
        time: DAY_ONE + 1000,
        userId: BLOCKED_USER_ID,
      },
    ])

    expect(entries.map(e => e.message.id)).toEqual(['a', 'b'])
  })

  test('a day divider goes in front of the first message of a new day', () => {
    const entries = layout([
      textFrom('a', USER_ID, DAY_ONE),
      textFrom('b', USER_ID, DAY_ONE + DAY_MS),
    ])

    expect(entries.map(e => e.newDayBefore)).toEqual([false, true])
  })

  test('a day holding only hidden messages gets no divider', () => {
    const entries = layout([
      textFrom('a', USER_ID, DAY_ONE),
      textFrom('b', BLOCKED_USER_ID, DAY_ONE + DAY_MS),
      textFrom('c', USER_ID, DAY_ONE + DAY_MS * 2),
    ])

    expect(entries.map(e => [e.message.id, e.newDayBefore])).toEqual([
      ['a', false],
      ['c', true],
    ])
  })

  test('a hidden message at the end of a day does not move the next day divider', () => {
    const entries = layout([
      textFrom('a', USER_ID, DAY_ONE),
      textFrom('b', BLOCKED_USER_ID, DAY_ONE + DAY_MS),
      textFrom('c', USER_ID, DAY_ONE + DAY_MS + 1000),
    ])

    expect(entries.map(e => [e.message.id, e.newDayBefore])).toEqual([
      ['a', false],
      ['c', true],
    ])
  })

  test('a leading hidden message does not count as the previous day', () => {
    const entries = layout([
      textFrom('a', BLOCKED_USER_ID, DAY_ONE),
      textFrom('b', USER_ID, DAY_ONE + DAY_MS),
    ])

    expect(entries.map(e => [e.message.id, e.newDayBefore])).toEqual([['b', false]])
  })

  test('the unread divider moves past a hidden first unread message', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', USER_ID, DAY_ONE + 2000),
      ],
      { unreadLineTime: DAY_ONE },
    )

    expect(entries.map(e => [e.message.id, e.unreadLineBefore])).toEqual([
      ['a', false],
      ['c', true],
    ])
  })

  test('the unread divider is absent when every unread message is hidden', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', BLOCKED_USER_ID, DAY_ONE + 2000),
      ],
      { unreadLineTime: DAY_ONE },
    )

    expect(entries.some(e => e.unreadLineBefore)).toBe(false)
  })

  test('a hidden read message still places the unread boundary in the window', () => {
    const entries = layout(
      [textFrom('a', BLOCKED_USER_ID, DAY_ONE), textFrom('b', USER_ID, DAY_ONE + 1000)],
      { unreadLineTime: DAY_ONE, hasMoreHistory: true },
    )

    expect(entries.map(e => [e.message.id, e.unreadLineBefore])).toEqual([['b', true]])
  })

  test('the unread divider stays on a blocked message that is not hidden', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', USER_ID, DAY_ONE + 2000),
      ],
      { unreadLineTime: DAY_ONE, hideBlocked: false },
    )

    expect(entries.map(e => e.unreadLineBefore)).toEqual([false, true, false])
  })

  test('a hidden message does not break a cozy group', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', USER_ID, DAY_ONE + 2000),
      ],
      { cozy: true },
    )

    expect(entries.map(e => e.layout)).toEqual(['cozyHeader', 'cozyContinuation'])
  })

  test('a blocked message that is not hidden still breaks a cozy group', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', USER_ID, DAY_ONE + 2000),
      ],
      { cozy: true, hideBlocked: false },
    )

    expect(entries.map(e => e.layout)).toEqual(['cozyHeader', undefined, 'cozyHeader'])
  })

  test('a moved unread divider starts a new cozy group', () => {
    const entries = layout(
      [
        textFrom('a', USER_ID, DAY_ONE),
        textFrom('b', BLOCKED_USER_ID, DAY_ONE + 1000),
        textFrom('c', USER_ID, DAY_ONE + 2000),
      ],
      { cozy: true, unreadLineTime: DAY_ONE },
    )

    expect(entries.map(e => e.layout)).toEqual(['cozyHeader', 'cozyHeader'])
  })

  test('the classic display mode gets no cozy layout', () => {
    const entries = layout([textFrom('a', USER_ID, DAY_ONE), textFrom('c', USER_ID, DAY_ONE + 1)])

    expect(entries.map(e => e.layout)).toEqual([undefined, undefined])
  })
})
