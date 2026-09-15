import { describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { publishWhisperEcho, subscribeToWhisperEchoes, WhisperEcho } from './whisper-echo'

const ECHO: WhisperEcho = {
  messageId: 'message-1',
  time: 1000,
  direction: 'incoming',
  counterpartId: makeSbUserId(1),
  text: 'hello',
}

describe('whisper-echo', () => {
  test('delivers a published echo to a subscribed listener', () => {
    const listener = vi.fn()
    subscribeToWhisperEchoes(listener)

    publishWhisperEcho(ECHO)

    expect(listener).toHaveBeenCalledExactlyOnceWith(ECHO)
  })

  test('stops delivering once unsubscribed', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToWhisperEchoes(listener)
    unsubscribe()

    publishWhisperEcho(ECHO)

    expect(listener).not.toHaveBeenCalled()
  })

  test('a listener unsubscribing during dispatch does not affect the others', () => {
    const first = vi.fn()
    const third = vi.fn()
    const second = vi.fn(() => unsubscribeSecond())

    subscribeToWhisperEchoes(first)
    const unsubscribeSecond = subscribeToWhisperEchoes(second)
    subscribeToWhisperEchoes(third)

    publishWhisperEcho(ECHO)

    expect(first).toHaveBeenCalledExactlyOnceWith(ECHO)
    expect(second).toHaveBeenCalledExactlyOnceWith(ECHO)
    expect(third).toHaveBeenCalledExactlyOnceWith(ECHO)

    // The unsubscribe from within the first dispatch should still have taken effect.
    publishWhisperEcho(ECHO)
    expect(second).toHaveBeenCalledOnce()
    expect(first).toHaveBeenCalledTimes(2)
    expect(third).toHaveBeenCalledTimes(2)
  })

  test('a listener that subscribes after a publish never sees it', () => {
    publishWhisperEcho(ECHO)

    const lateListener = vi.fn()
    subscribeToWhisperEchoes(lateListener)

    expect(lateListener).not.toHaveBeenCalled()
  })
})
