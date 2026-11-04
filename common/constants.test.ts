import { describe, expect, test } from 'vitest'
import { isValidUsername, USERNAME_PATTERN } from './constants'

describe('common/constants/isValidUsername', () => {
  test('rejects dot-segment usernames', () => {
    expect(isValidUsername('.')).toBe(false)
    expect(isValidUsername('..')).toBe(false)
    expect(USERNAME_PATTERN.test('.')).toBe(false)
    expect(USERNAME_PATTERN.test('..')).toBe(false)
  })

  test('accepts other dot-containing usernames', () => {
    expect(isValidUsername('...')).toBe(true)
    expect(isValidUsername('.a')).toBe(true)
    expect(isValidUsername('a.')).toBe(true)
    expect(isValidUsername('a..b')).toBe(true)
  })
})
