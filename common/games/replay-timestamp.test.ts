import { describe, expect, test } from 'vitest'
import {
  formatReplayTimestamp,
  parseReplayTimestamp,
  replayFrameForSeconds,
} from './replay-timestamp'

describe('parseReplayTimestamp', () => {
  test('parses plain seconds', () => {
    expect(parseReplayTimestamp('754')).toBe(754)
    expect(parseReplayTimestamp('754s')).toBe(754)
  })

  test('parses unit form', () => {
    expect(parseReplayTimestamp('12m34s')).toBe(754)
    expect(parseReplayTimestamp('12m')).toBe(720)
    expect(parseReplayTimestamp('1h2m3s')).toBe(3723)
    expect(parseReplayTimestamp('1h')).toBe(3600)
  })

  test('parses clock form', () => {
    expect(parseReplayTimestamp('12:34')).toBe(754)
    expect(parseReplayTimestamp('1:02:03')).toBe(3723)
  })

  test('rejects missing, zero, malformed, and absurd times', () => {
    expect(parseReplayTimestamp(undefined)).toBeUndefined()
    expect(parseReplayTimestamp(null)).toBeUndefined()
    expect(parseReplayTimestamp('')).toBeUndefined()
    expect(parseReplayTimestamp('0')).toBeUndefined()
    expect(parseReplayTimestamp('0m0s')).toBeUndefined()
    expect(parseReplayTimestamp('h')).toBeUndefined()
    expect(parseReplayTimestamp('12:3')).toBeUndefined()
    expect(parseReplayTimestamp('-5')).toBeUndefined()
    expect(parseReplayTimestamp('1.5')).toBeUndefined()
    expect(parseReplayTimestamp('12m34')).toBeUndefined()
    expect(parseReplayTimestamp('abc')).toBeUndefined()
    expect(parseReplayTimestamp('100000')).toBeUndefined()
  })
})

describe('formatReplayTimestamp', () => {
  test('formats with only the units it needs', () => {
    expect(formatReplayTimestamp(5)).toBe('5s')
    expect(formatReplayTimestamp(754)).toBe('12m34s')
    expect(formatReplayTimestamp(3600)).toBe('1h0m0s')
    expect(formatReplayTimestamp(3723)).toBe('1h2m3s')
  })

  test('round trips through parsing', () => {
    for (const seconds of [1, 59, 60, 754, 3599, 3600, 7322]) {
      expect(parseReplayTimestamp(formatReplayTimestamp(seconds))).toBe(seconds)
    }
  })
})

describe('replayFrameForSeconds', () => {
  test('converts game time to frames at 42ms per frame', () => {
    expect(replayFrameForSeconds(42)).toBe(1000)
    expect(replayFrameForSeconds(754)).toBe(17952)
  })
})
