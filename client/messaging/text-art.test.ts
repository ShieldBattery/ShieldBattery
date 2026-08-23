import { describe, expect, test } from 'vitest'
import { applyTextArtCommand } from './text-art'

describe('messaging/text-art/applyTextArtCommand', () => {
  test('a bare command becomes its art', () => {
    expect(applyTextArtCommand('/shrug')).toBe('¯\\_(ツ)_/¯')
  })

  test('a command with a message appends the art after the message', () => {
    expect(applyTextArtCommand('/shrug oh well')).toBe('oh well ¯\\_(ツ)_/¯')
  })

  test('commands match case-insensitively', () => {
    expect(applyTextArtCommand('/TableFlip')).toBe('(╯°□°)╯︵ ┻━┻')
  })

  test('multi-line art goes on its own lines after the message', () => {
    const result = applyTextArtCommand('/trex rawr')
    expect(result.startsWith('rawr\n')).toBe(true)
    expect(result).toContain('_.----._')
  })

  test('unknown commands are left alone', () => {
    expect(applyTextArtCommand('/frobnicate hello')).toBe('/frobnicate hello')
  })

  test('a known command as a prefix of a longer word does not match', () => {
    expect(applyTextArtCommand('/shrugged')).toBe('/shrugged')
  })

  test('commands mid-message are left alone', () => {
    expect(applyTextArtCommand('well /shrug')).toBe('well /shrug')
  })
})
