import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getLocalLineTime } from './local-output-placement'
import { CommonMessageType, CommonTextMessage } from './message-records'

const AUTHOR_ID = makeSbUserId(1)

function serverMessage(id: string, time: number): CommonTextMessage {
  return { id, type: CommonMessageType.TextMessage, from: AUTHOR_ID, text: id, time }
}

describe('client/messaging/local-output-placement', () => {
  test('a line takes the newest loaded message time, so it sorts after it', () => {
    const messages = [serverMessage('older', 100), serverMessage('newest', 200)]

    expect(getLocalLineTime(messages, false)).toBe(200)
  })

  test('the newest time anywhere in the list wins, even out of order', () => {
    const messages = [serverMessage('newest', 300), serverMessage('older', 100)]

    expect(getLocalLineTime(messages, false)).toBe(300)
  })

  test('an empty conversation stamps the line from the local clock', () => {
    const now = Date.now()

    expect(getLocalLineTime([], false)).toBeGreaterThanOrEqual(now)
  })

  test('a window detached from the present stamps the line no earlier than now', () => {
    const now = Date.now()
    const messages = [serverMessage('history', 100)]

    expect(getLocalLineTime(messages, true)).toBeGreaterThanOrEqual(now)
  })
})
