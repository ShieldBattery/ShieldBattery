import { describe, expect, test } from 'vitest'
import { countEmojisIn, matchUnicodeEmojis } from './unicode-emojis'

describe('common/text/unicode-emojis/matchUnicodeEmojis', () => {
  const doMatch = (text: string): Array<{ text: string; index: number }> => {
    return Array.from(matchUnicodeEmojis(text), match => ({
      text: match.text,
      index: match.index,
    }))
  }

  test('single emoji', () => {
    expect(doMatch('😀')).toEqual([{ text: '😀', index: 0 }])
  })

  test('multi-codepoint ZWJ sequence', () => {
    expect(doMatch('👨‍👩‍👦')).toEqual([{ text: '👨‍👩‍👦', index: 0 }])
  })

  test('consecutive emoji coalesce into one run', () => {
    expect(doMatch('😀😂🎉')).toEqual([{ text: '😀😂🎉', index: 0 }])
  })

  test('emoji mid-text has the correct index', () => {
    expect(doMatch('gg 😀 wp')).toEqual([{ text: '😀', index: 3 }])
  })

  test('separate runs of emoji stay separate matches', () => {
    expect(doMatch('😀 wp 🎉')).toEqual([
      { text: '😀', index: 0 },
      { text: '🎉', index: 6 },
    ])
  })

  test('plain text does not match', () => {
    expect(doMatch('This is test message')).toEqual([])
  })

  test('digits do not match', () => {
    expect(doMatch('12345')).toEqual([])
  })

  test('timestamp does not match', () => {
    expect(doMatch('see you at 10:30')).toEqual([])
  })

  test('lone hash does not match', () => {
    expect(doMatch('#')).toEqual([])
  })

  test('keycap sequence matches', () => {
    expect(doMatch('1️⃣')).toEqual([{ text: '1️⃣', index: 0 }])
  })
})

describe('common/text/unicode-emojis/countEmojisIn', () => {
  test('counts zero for plain text', () => {
    expect(countEmojisIn('This is test message')).toBe(0)
  })

  test('counts a single emoji', () => {
    expect(countEmojisIn('gg 😀 wp')).toBe(1)
  })

  test('counts each emoji in a run separately', () => {
    expect(countEmojisIn('😀😂🎉')).toBe(3)
  })

  test('counts a multi-codepoint ZWJ sequence as one', () => {
    expect(countEmojisIn('👨‍👩‍👦')).toBe(1)
  })

  test('counts emoji across multiple runs', () => {
    expect(countEmojisIn('😀 wp 🎉🎉')).toBe(3)
  })
})
