import { beforeAll, describe, expect, test } from 'vitest'
import { getPickerEmojiData, getUnicodeEmojiEntries } from './emoji-data'
import { EMOTE_QUERY_REGEX, orderEmoteSuggestions, searchUnicodeEmojis } from './emote-suggestions'

describe('messaging/emote-suggestions', () => {
  describe('EMOTE_QUERY_REGEX', () => {
    const queryFor = (text: string) => EMOTE_QUERY_REGEX.exec(text)?.groups?.query

    test('matches a query at the message start', () => {
      expect(queryFor(':fi')).toBe('fi')
    })

    test('matches a query after whitespace', () => {
      expect(queryFor('gg :probe')).toBe('probe')
    })

    test('needs at least two characters', () => {
      expect(queryFor(':f')).toBeUndefined()
    })

    test('does not match mid-word colons like times', () => {
      expect(queryFor('see you at 10:30')).toBeUndefined()
    })
  })

  describe('suggestions against the real dataset', () => {
    // The first call dynamically imports and parses the full emoji dataset, which can take
    // longer than the per-test timeout on a cold CI runner — pay that cost here, with a
    // timeout to match, so the tests below only measure the search logic
    beforeAll(async () => {
      await getUnicodeEmojiEntries()
    }, 30_000)

    test(':fire suggests the flame emoji first', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = orderEmoteSuggestions(searchUnicodeEmojis(entries, 'fire'))
      expect(suggestions[0].emoji).toBe('🔥')
    })

    test('shortcode-style underscores match spaced names', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = searchUnicodeEmojis(entries, 'grinning_face')
      expect(suggestions[0].emoji).toBe('😀')
    })

    test('displays the Discord/Slack-style shortcode as the suggestion name', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = searchUnicodeEmojis(entries, 'sweat_smile')
      expect(suggestions[0].emoji).toBe('😅')
      expect(suggestions[0].name).toBe(':sweat_smile:')
    })

    test('a secondary shortcode is searchable too', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = searchUnicodeEmojis(entries, 'thumbsup')
      expect(suggestions[0].emoji).toBe('👍')
    })

    test('a typo with no separator still fuzzy-matches via the shortcode', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = searchUnicodeEmojis(entries, 'swetsmile')
      const sweatSmile = suggestions.find(s => s.emoji === '😅')
      expect(sweatSmile?.rank).toBe(3)
    })

    test('fuzzy matches never outrank exact/prefix/substring ones', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = orderEmoteSuggestions(searchUnicodeEmojis(entries, 'fire'))
      expect(suggestions[0].emoji).toBe('🔥')
      // Ranks are sorted ascending, so a rank-3 result can never precede a better one
      const ranks = suggestions.map(s => s.rank)
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
    })
  })

  describe('orderEmoteSuggestions', () => {
    test('more-used suggestions rank first within the same match quality', () => {
      const unicode = [
        { key: 'u0', insertText: 'a', name: 'a', rank: 0, emoji: 'a' },
        { key: 'u1', insertText: 'b', name: 'b', rank: 0, emoji: 'b' },
        { key: 'u2', insertText: 'c', name: 'c', rank: 1, emoji: 'c' },
      ]
      const usage: Record<string, number> = { u1: 5, u2: 100 }
      const result = orderEmoteSuggestions(unicode, key => usage[key] ?? 0)
      // Usage breaks the tie within rank 0, but never promotes a worse match above a better one
      expect(result.map(s => s.key)).toEqual(['u1', 'u0', 'u2'])
    })
  })

  describe('getPickerEmojiData against the real dataset', () => {
    // Builds the augmented dataset from the same two real, dynamically-imported sources as
    // "suggestions against the real dataset" above, so it needs the same generous timeout.
    beforeAll(async () => {
      await getPickerEmojiData()
    }, 30_000)

    function findEmoji(data: Awaited<ReturnType<typeof getPickerEmojiData>>, unified: string) {
      return Object.values(data.emojis)
        .flat()
        .find(e => e.u === unified)
    }

    test('a secondary shortcode is prepended to n, keeping the display name last', async () => {
      const data = await getPickerEmojiData()
      const emoji = findEmoji(data, '1f605')
      expect(emoji?.n).toContain('sweat_smile')
      expect(emoji?.n.at(-1)).toBe('grinning face with sweat')
    })

    test('the picker searches by shortcode', async () => {
      const data = await getPickerEmojiData()
      const emoji = findEmoji(data, '1f44d')
      expect(emoji?.n).toContain('thumbsup')
    })
  })
})
