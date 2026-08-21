import { describe, expect, test } from 'vitest'
import { matchCustomEmotes } from './custom-emotes'

describe('common/text/custom-emotes/matchCustomEmotes', () => {
  const doMatch = (text: string): string[] => {
    return Array.from(matchCustomEmotes(text), match => match.groups.code)
  }

  test('emote as entire text', () => {
    expect(doMatch(':bwProbe:')).toEqual(['bwProbe'])
  })

  test('emote inside text', () => {
    expect(doMatch('gg :bwGg: wp')).toEqual(['bwGg'])
  })

  test('multiple emotes', () => {
    expect(doMatch(':bwProbe::bwMarine: and :bwGg:')).toEqual(['bwProbe', 'bwMarine', 'bwGg'])
  })

  test('unknown codes are not matched', () => {
    expect(doMatch(':notAnEmote: :probe:')).toEqual([])
  })

  test('codes match case-insensitively', () => {
    expect(doMatch(':bwprobe: :BWGG:')).toEqual(['bwprobe', 'BWGG'])
  })

  test('code without both colons is not matched', () => {
    expect(doMatch('bwProbe :bwProbe')).toEqual([])
  })

  test('timestamps are not matched', () => {
    expect(doMatch('see you at 10:30:45')).toEqual([])
  })
})
