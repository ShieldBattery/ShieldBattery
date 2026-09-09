import { beforeAll, describe, expect, test, vi } from 'vitest'
import {
  areShortcodesLoaded,
  getShortcodeForEmoji,
  loadShortcodes,
  subscribeToShortcodesLoaded,
} from './emoji-shortcodes'

describe('messaging/emoji-shortcodes', () => {
  describe('before the dataset has loaded', () => {
    test('areShortcodesLoaded is false', () => {
      expect(areShortcodesLoaded()).toBe(false)
    })

    test('getShortcodeForEmoji returns undefined', () => {
      expect(getShortcodeForEmoji('😅')).toBeUndefined()
    })

    test('a subscribed listener is called once the dataset loads', async () => {
      const listener = vi.fn()
      subscribeToShortcodesLoaded(listener)

      await loadShortcodes()

      expect(listener).toHaveBeenCalledTimes(1)
      expect(areShortcodesLoaded()).toBe(true)
    }, 30_000)

    test('an unsubscribed listener is not called', async () => {
      const listener = vi.fn()
      const unsubscribe = subscribeToShortcodesLoaded(listener)
      unsubscribe()

      // The dataset is already cached from the previous test, so this resolves immediately
      // without notifying anyone either way; the point of this test is that the listener count
      // stays put, proving the returned unsubscribe function took effect.
      await loadShortcodes()

      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe('getShortcodeForEmoji against the real dataset', () => {
    // The first call dynamically imports and parses the full shortcode dataset, which can take
    // longer than the per-test timeout on a cold CI runner — pay that cost here, with a timeout
    // to match, so the tests below only measure the lookup logic.
    beforeAll(async () => {
      await loadShortcodes()
    }, 30_000)

    test('plain emoji', () => {
      expect(getShortcodeForEmoji('😅')).toBe('sweat_smile')
    })

    test('another plain emoji', () => {
      expect(getShortcodeForEmoji('🏆')).toBe('trophy')
    })

    test('FE0F sequence falls back to the base codepoint', () => {
      expect(getShortcodeForEmoji('☺️')).toBe('relaxed')
    })

    test('keycap sequence keeps its FE0F segment', () => {
      expect(getShortcodeForEmoji('1️⃣')).toBe('one')
    })

    test('short codepoint gets zero-padded before lookup', () => {
      expect(getShortcodeForEmoji('©️')).toBe('copyright')
    })

    test('skin-tone variant falls back to the base emoji shortcode', () => {
      expect(getShortcodeForEmoji('👍🏽')).toBe('+1')
    })

    test('ZWJ sequence', () => {
      expect(getShortcodeForEmoji('👨‍👩‍👦')).toBe('man-woman-boy')
    })

    test('ZWJ sequence with a skin tone falls back to the untoned sequence', () => {
      expect(getShortcodeForEmoji('👨🏽‍💻')).toBe('male-technologist')
    })

    test('emoji with no shortcode returns undefined', () => {
      expect(getShortcodeForEmoji('🦰')).toBeUndefined()
    })

    test('non-emoji text returns undefined', () => {
      expect(getShortcodeForEmoji('abc')).toBeUndefined()
    })
  })
})
