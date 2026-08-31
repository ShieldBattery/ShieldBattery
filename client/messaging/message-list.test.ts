import { describe, expect, test } from 'vitest'
import {
  ClientChatMessageType,
  makeSbChannelId,
  ServerChatMessageType,
  type ChatMessage,
} from '../../common/chat'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { findUnreadLineIndex } from './message-list'
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
