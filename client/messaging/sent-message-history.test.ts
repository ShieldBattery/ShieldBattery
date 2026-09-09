import { describe, expect, test } from 'vitest'
import { MAX_SENT_MESSAGE_HISTORY, SentMessageHistory } from './sent-message-history'

describe('messaging/sent-message-history', () => {
  describe('older', () => {
    test('returns undefined when nothing has been sent', () => {
      const history = new SentMessageHistory()
      expect(history.older('')).toBeUndefined()
    })

    test('steps backward through sent messages, stopping at the oldest', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')

      expect(history.older('')).toBe('c')
      expect(history.older('c')).toBe('b')
      expect(history.older('b')).toBe('a')
      expect(history.older('a')).toBeUndefined()
    })

    test('restarts from the newest entry when the input is cleared mid-recall', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')

      expect(history.older('')).toBe('c')
      expect(history.older('c')).toBe('b')
      expect(history.older('')).toBe('c')
    })

    test('does not step when the recalled text has been edited', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')

      expect(history.older('')).toBe('c')
      expect(history.older('c edited')).toBeUndefined()
    })
  })

  describe('newer', () => {
    test('returns undefined when no recall is in progress', () => {
      const history = new SentMessageHistory()
      history.push('a')

      expect(history.newer('a')).toBeUndefined()
    })

    test('steps forward and ends the recall past the newest entry', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')
      history.older('')
      history.older('c')
      history.older('b')

      expect(history.newer('a')).toBe('b')
      expect(history.newer('b')).toBe('c')
      expect(history.newer('c')).toBe('')
      expect(history.newer('')).toBeUndefined()
      expect(history.older('')).toBe('c')
    })

    test('does not step when the recalled text has been edited', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')

      expect(history.older('')).toBe('c')
      expect(history.older('c edited')).toBeUndefined()
      expect(history.newer('c edited')).toBeUndefined()
    })
  })

  describe('push', () => {
    test('ends any recall in progress', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('c')

      expect(history.older('')).toBe('c')
      history.push('d')
      expect(history.newer('c')).toBeUndefined()
      expect(history.older('')).toBe('d')
    })

    test('skips a consecutive duplicate', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('a')

      expect(history.older('')).toBe('a')
      expect(history.older('a')).toBeUndefined()
    })

    test('keeps non-consecutive duplicates as separate entries', () => {
      const history = new SentMessageHistory()
      history.push('a')
      history.push('b')
      history.push('a')

      expect(history.older('')).toBe('a')
      expect(history.older('a')).toBe('b')
      expect(history.older('b')).toBe('a')
    })

    test('drops the oldest entry once the history exceeds its cap', () => {
      const history = new SentMessageHistory()
      for (let i = 0; i <= MAX_SENT_MESSAGE_HISTORY; i++) {
        history.push(`m${i}`)
      }

      let current = history.older('')
      expect(current).toBe(`m${MAX_SENT_MESSAGE_HISTORY}`)

      for (let i = 0; i < MAX_SENT_MESSAGE_HISTORY - 1; i++) {
        current = history.older(current!)
      }
      expect(current).toBe('m1')
      expect(history.older(current!)).toBeUndefined()
    })
  })
})
