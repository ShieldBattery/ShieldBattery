import { describe, expect, test } from 'vitest'
import { ClientChatMessageType, makeSbChannelId, ServerChatMessageType } from '../../common/chat'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { anchorNeedsFetch, ChatViewAnchor, findChatViewPlacement } from './chat-view-anchor'
import { SbMessage } from './message-records'

const CHANNEL_ID = makeSbChannelId(1)
const USER_ID = makeSbUserId(2)

/** A channel text message, which the server persists and stamps with its own clock. */
function serverMessage(id: string, time: number): SbMessage {
  return {
    id,
    type: ServerChatMessageType.TextMessage,
    channelId: CHANNEL_ID,
    time,
    from: USER_ID,
    text: 'hi',
  }
}

/** A channel leave banner, whose time comes from the local clock. */
function clientMessage(id: string, time: number): SbMessage {
  return {
    id,
    type: ClientChatMessageType.LeaveChannel,
    channelId: CHANNEL_ID,
    time,
    userId: USER_ID,
  }
}

function anchor(overrides: Partial<ChatViewAnchor> = {}): ChatViewAnchor {
  return { messageId: 'b', sentTime: 200, offsetPx: -12, ...overrides }
}

describe('messaging/chat-view-anchor/findChatViewPlacement', () => {
  test('positions against the anchor message when the window still holds it', () => {
    const messages = [serverMessage('a', 100), serverMessage('b', 200), serverMessage('c', 300)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({
      kind: 'message',
      messageId: 'b',
      offsetPx: -12,
    })
  })

  test('positions against the next message when the anchor message is gone', () => {
    const messages = [serverMessage('a', 100), serverMessage('c', 300)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({
      kind: 'message',
      messageId: 'c',
      offsetPx: 0,
    })
  })

  test('positions against a message sent at exactly the anchor time', () => {
    const messages = [serverMessage('a', 100), serverMessage('c', 200)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({
      kind: 'message',
      messageId: 'c',
      offsetPx: 0,
    })
  })

  test('asks for a fetch when the whole window is newer than the anchor', () => {
    const messages = [serverMessage('c', 300), serverMessage('d', 400)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({ kind: 'fetch' })
  })

  test('asks for a fetch when nothing is loaded', () => {
    expect(findChatViewPlacement([], anchor())).toEqual({ kind: 'fetch' })
  })

  test('asks for a fetch when the window holds only client-stamped messages', () => {
    const messages = [clientMessage('x', 100), clientMessage('y', 300)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({ kind: 'fetch' })
  })

  test('falls back to the bottom when the whole window predates the anchor', () => {
    const messages = [serverMessage('a', 50), serverMessage('b2', 100)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({ kind: 'bottom' })
  })

  test('ignores client-stamped times when deciding what stands in for the anchor', () => {
    const messages = [serverMessage('a', 100), clientMessage('x', 250), serverMessage('c', 300)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({
      kind: 'message',
      messageId: 'c',
      offsetPx: 0,
    })
  })

  test('keeps the anchor message even when its own time is client-stamped', () => {
    const messages = [serverMessage('a', 100), clientMessage('b', 200), serverMessage('c', 300)]

    expect(findChatViewPlacement(messages, anchor())).toEqual({
      kind: 'message',
      messageId: 'b',
      offsetPx: -12,
    })
  })
})

describe('messaging/chat-view-anchor/anchorNeedsFetch', () => {
  test('is true only when the position sits before the loaded window', () => {
    expect(anchorNeedsFetch([serverMessage('c', 300)], anchor())).toBe(true)
    expect(anchorNeedsFetch([], anchor())).toBe(true)
    expect(anchorNeedsFetch([serverMessage('b', 200)], anchor())).toBe(false)
    expect(anchorNeedsFetch([serverMessage('a', 100)], anchor())).toBe(false)
  })
})
