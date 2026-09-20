import { describe, expect, test } from 'vitest'
import { isValidUsername } from '../../../common/constants'
import { generateRandomDisplayName } from './random-display-name'

describe('client/users/admin/random-display-name', () => {
  test('generates names that are valid usernames', () => {
    for (let i = 0; i < 2000; i++) {
      const name = generateRandomDisplayName()
      expect(isValidUsername(name), `${name} should be a valid username`).toBe(true)
      expect(name).toMatch(/^[A-Za-z]+\d{2,3}$/)
    }
  })

  test('generates more than one distinct name', () => {
    const names = new Set<string>()
    for (let i = 0; i < 50; i++) {
      names.add(generateRandomDisplayName())
    }

    expect(names.size).toBeGreaterThan(1)
  })
})
