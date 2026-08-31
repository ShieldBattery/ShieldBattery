import { describe, expect, test } from 'vitest'
import {
  formatJoinCode,
  isValidJoinCode,
  LOBBY_JOIN_CODE_LENGTH,
  normalizeJoinCode,
} from './join-code'

describe('lobbies/join-code', () => {
  describe('normalizeJoinCode', () => {
    test('uppercases lower case input', () => {
      expect(normalizeJoinCode('bq4xm9')).toBe('BQ4XM9')
    })

    test('strips a dash', () => {
      expect(normalizeJoinCode('BQ4-XM9')).toBe('BQ4XM9')
    })

    test('strips surrounding and interior spaces', () => {
      expect(normalizeJoinCode(' BQ4 XM9 ')).toBe('BQ4XM9')
    })

    test('handles mixed case, dashes, and spaces together', () => {
      expect(normalizeJoinCode(' bq4 - xM9 ')).toBe('BQ4XM9')
    })

    test('leaves an already-normalized code unchanged', () => {
      expect(normalizeJoinCode('BQ4XM9')).toBe('BQ4XM9')
    })
  })

  describe('isValidJoinCode', () => {
    test('accepts a well-formed code', () => {
      expect(isValidJoinCode('BQ4XM9')).toBe(true)
    })

    test('rejects a code that is too short', () => {
      expect(isValidJoinCode('BQ4XM')).toBe(false)
    })

    test('rejects a code that is too long', () => {
      expect(isValidJoinCode('BQ4XM99')).toBe(false)
    })

    test('rejects an empty string', () => {
      expect(isValidJoinCode('')).toBe(false)
    })

    test('rejects a code containing a character outside the alphabet', () => {
      // 'O', 'I', '0', and '1' are all deliberately excluded from the join code alphabet (they're
      // easily confused for other characters), so a code containing one is never valid even
      // though it's otherwise well-formed.
      expect(isValidJoinCode('BQ4XMO')).toBe(false)
      expect(isValidJoinCode('BQ4XMI')).toBe(false)
      expect(isValidJoinCode('BQ4XM0')).toBe(false)
      expect(isValidJoinCode('BQ4XM1')).toBe(false)
    })

    test('rejects lower case input', () => {
      // Validation expects normalized input; callers must normalize first.
      expect(isValidJoinCode('bq4xm9')).toBe(false)
    })

    test('rejects a code still carrying its display dash', () => {
      expect(isValidJoinCode('BQ4-XM9')).toBe(false)
    })
  })

  describe('formatJoinCode', () => {
    test('inserts a dash at the midpoint', () => {
      expect(formatJoinCode('BQ4XM9')).toBe('BQ4-XM9')
    })

    test('matches LOBBY_JOIN_CODE_LENGTH for the midpoint split', () => {
      expect(LOBBY_JOIN_CODE_LENGTH).toBe(6)
      const normalized = 'ABCDEF'
      expect(formatJoinCode(normalized)).toBe('ABC-DEF')
    })
  })
})
