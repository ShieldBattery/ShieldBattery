import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getLocalLineTime, mergeLocalLines } from './local-output-placement'
import {
  CommonLocalLineMessage,
  CommonMessageType,
  CommonTextMessage,
  CommonWhisperEchoMessage,
  SbMessage,
} from './message-records'

const AUTHOR_ID = makeSbUserId(1)
const COUNTERPART_ID = makeSbUserId(2)

function serverMessage(id: string, time: number): CommonTextMessage {
  return { id, type: CommonMessageType.TextMessage, from: AUTHOR_ID, text: id, time }
}

function localLine(id: string, time: number): CommonLocalLineMessage {
  return { id, type: CommonMessageType.LocalLine, time, kind: 'info', content: id }
}

function echo(id: string, time: number): CommonWhisperEchoMessage {
  return {
    id,
    type: CommonMessageType.WhisperEcho,
    time,
    direction: 'incoming',
    counterpartId: COUNTERPART_ID,
    text: id,
    sentTime: time,
  }
}

function idsOf(messages: ReadonlyArray<SbMessage>): string[] {
  return messages.map(m => m.id)
}

describe('client/messaging/local-output-placement', () => {
  test('a line stamped from the newest message sorts after it', () => {
    const messages = [serverMessage('older', 100), serverMessage('newest', 200)]
    const time = getLocalLineTime(messages, false)

    expect(time).toBe(200)
    expect(idsOf(mergeLocalLines(messages, [localLine('line', time)]))).toEqual([
      'older',
      'newest',
      'line',
    ])
  })

  test('a window detached from the present stamps the line no earlier than now', () => {
    const now = Date.now()
    const messages = [serverMessage('history', 100)]

    expect(getLocalLineTime(messages, true)).toBeGreaterThanOrEqual(now)
  })

  test('a server message that arrives later sorts after the line', () => {
    const messages = [serverMessage('newest', 200)]
    const line = localLine('line', getLocalLineTime(messages, false))

    const withReply = [...messages, serverMessage('reply', 300)]

    expect(idsOf(mergeLocalLines(withReply, [line]))).toEqual(['newest', 'line', 'reply'])
  })

  test("a line older than the window's oldest server message is dropped", () => {
    const messages = [serverMessage('oldest', 200), serverMessage('newest', 300)]

    expect(idsOf(mergeLocalLines(messages, [localLine('line', 100)]))).toEqual(['oldest', 'newest'])
  })

  test('echoes and local lines interleave by time', () => {
    const messages = [serverMessage('first', 100), serverMessage('second', 300)]
    const lines = [echo('echo-late', 400), localLine('line', 200), echo('echo-early', 150)]

    expect(idsOf(mergeLocalLines(messages, lines))).toEqual([
      'first',
      'echo-early',
      'line',
      'second',
      'echo-late',
    ])
  })
})
