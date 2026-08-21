import { describe, expect, test } from 'vitest'
import { getUnicodeEmojiEntries } from './emoji-data'
import {
  EMOTE_QUERY_REGEX,
  matchRank,
  mergeEmoteSuggestions,
  searchCustomEmotes,
  searchUnicodeEmojis,
} from './emote-suggestions'

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

  describe('matchRank', () => {
    test('ranks exact over prefix over substring', () => {
      expect(matchRank(['fire', 'flame'], 'fire')).toBe(0)
      expect(matchRank(['firebat'], 'fire')).toBe(1)
      expect(matchRank(['campfire'], 'fire')).toBe(2)
      expect(matchRank(['water'], 'fire')).toBe(-1)
    })
  })

  describe('suggestions against the real dataset', () => {
    test(':fire suggests the flame emoji ahead of the Firebat emote', async () => {
      const entries = await getUnicodeEmojiEntries()
      const merged = mergeEmoteSuggestions(
        searchCustomEmotes('fire'),
        searchUnicodeEmojis(entries, 'fire'),
      )
      expect(merged[0].emoji).toBe('🔥')
      // Firebat is only a prefix match, so it comes after every exact match but is still offered
      const firebatIndex = merged.findIndex(s => s.key === 'bwFirebat')
      expect(firebatIndex).toBeGreaterThan(0)
      expect(merged.slice(0, firebatIndex).every(s => s.rank === 0)).toBe(true)
    })

    test(':fireb suggests the Firebat emote first', async () => {
      const entries = await getUnicodeEmojiEntries()
      const merged = mergeEmoteSuggestions(
        searchCustomEmotes('fireb'),
        searchUnicodeEmojis(entries, 'fireb'),
      )
      expect(merged[0].key).toBe('bwFirebat')
    })

    test(':pro suggests the Probe emote first', async () => {
      const entries = await getUnicodeEmojiEntries()
      const merged = mergeEmoteSuggestions(
        searchCustomEmotes('pro'),
        searchUnicodeEmojis(entries, 'pro'),
      )
      expect(merged[0].key).toBe('bwProbe')
      expect(merged[0].insertText).toBe(':bwProbe: ')
    })

    test('shortcode-style underscores match spaced names', async () => {
      const entries = await getUnicodeEmojiEntries()
      const suggestions = searchUnicodeEmojis(entries, 'grinning_face')
      expect(suggestions[0].emoji).toBe('😀')
    })
  })

  describe('mergeEmoteSuggestions', () => {
    const noUsage = () => 0

    test('custom emotes win ties in match quality', () => {
      const custom = [{ key: 'c', insertText: ':c: ', name: 'c', rank: 1, imgUrl: 'x' }]
      const unicode = [
        { key: 'u0', insertText: 'a', name: 'a', rank: 0, emoji: 'a' },
        { key: 'u1', insertText: 'b', name: 'b', rank: 1, emoji: 'b' },
      ]
      expect(mergeEmoteSuggestions(custom, unicode, noUsage).map(s => s.key)).toEqual([
        'u0',
        'c',
        'u1',
      ])
    })

    test('more-used suggestions rank first within the same match quality', () => {
      const unicode = [
        { key: 'u0', insertText: 'a', name: 'a', rank: 0, emoji: 'a' },
        { key: 'u1', insertText: 'b', name: 'b', rank: 0, emoji: 'b' },
        { key: 'u2', insertText: 'c', name: 'c', rank: 1, emoji: 'c' },
      ]
      const usage: Record<string, number> = { u1: 5, u2: 100 }
      const result = mergeEmoteSuggestions([], unicode, key => usage[key] ?? 0)
      // Usage breaks the tie within rank 0, but never promotes a worse match above a better one
      expect(result.map(s => s.key)).toEqual(['u1', 'u0', 'u2'])
    })
  })
})
