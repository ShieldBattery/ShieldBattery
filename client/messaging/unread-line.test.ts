import { describe, expect, test } from 'vitest'
import {
  isUnreadLineSpent,
  placeUnreadLine,
  shouldReplaceUnreadLine,
  UnreadLine,
} from './unread-line'

describe('client/messaging/unread-line', () => {
  describe('placeUnreadLine', () => {
    test('places a divider nobody has looked at yet', () => {
      expect(placeUnreadLine(100, true)).toEqual({
        time: 100,
        seen: false,
        leftBottom: false,
        caughtUp: false,
      })
    })

    test('counts a view placing one away from the bottom as having left it', () => {
      expect(placeUnreadLine(100, false)).toEqual({
        time: 100,
        seen: false,
        leftBottom: true,
        caughtUp: false,
      })
    })
  })

  describe('isUnreadLineSpent', () => {
    const line: UnreadLine = { time: 100, seen: true, leftBottom: true, caughtUp: false }

    test('is true for a divider looked at, left behind, and returned to past it', () => {
      expect(isUnreadLineSpent(line, true, 200)).toBe(true)
    })

    test('is false for a divider that has never been in view', () => {
      expect(isUnreadLineSpent({ ...line, seen: false }, true, 200)).toBe(false)
    })

    test('is false while the view has never been away from the bottom', () => {
      expect(isUnreadLineSpent({ ...line, leftBottom: false }, true, 200)).toBe(false)
    })

    test('is false while the view is away from the bottom', () => {
      expect(isUnreadLineSpent(line, false, 200)).toBe(false)
    })

    test('is false while the read position has not passed the divider', () => {
      expect(isUnreadLineSpent(line, true, 100)).toBe(false)
      expect(isUnreadLineSpent(line, true, undefined)).toBe(false)
    })
  })

  describe('shouldReplaceUnreadLine', () => {
    const line: UnreadLine = { time: 100, seen: true, leftBottom: true, caughtUp: true }

    test('is true where there is no divider yet', () => {
      expect(shouldReplaceUnreadLine(undefined, 200)).toBe(true)
    })

    test('is true for a divider the user caught up past', () => {
      expect(shouldReplaceUnreadLine(line, 200)).toBe(true)
    })

    test('is false for a divider the user has not caught up past', () => {
      expect(shouldReplaceUnreadLine({ ...line, caughtUp: false }, 200)).toBe(false)
    })

    test('is false while the read position has not passed the divider', () => {
      expect(shouldReplaceUnreadLine(line, 100)).toBe(false)
    })

    test('is false when there is no read position to freeze at', () => {
      expect(shouldReplaceUnreadLine(undefined, undefined)).toBe(false)
      expect(shouldReplaceUnreadLine(line, undefined)).toBe(false)
    })
  })
})
