import { describe, expect, test } from 'vitest'
import { RANDOM_EMAIL_CODE_PATTERN } from '../../../common/users/user-network'
import { genRandomCode, genShortRandomCode } from './random-code'

const SHORT_RANDOM_CODE_PATTERN = /^[BCDFGHJKLMNPQRTWXY3469]{3}-[BCDFGHJKLMNPQRTWXY3469]{3}$/

describe('genRandomCode', () => {
  test('should generate a code in the format XXXXX-XXXXX', async () => {
    const code = await genRandomCode()
    expect(code).toMatch(RANDOM_EMAIL_CODE_PATTERN)
  })

  test('should generate different codes on subsequent calls', async () => {
    const code1 = await genRandomCode()
    const code2 = await genRandomCode()
    expect(code1).not.toBe(code2)
  })

  test('should generate codes with only valid letters', async () => {
    const codes = await Promise.all(new Array(2000).fill(0).map(() => genRandomCode()))
    for (const code of codes) {
      expect(code).toMatch(RANDOM_EMAIL_CODE_PATTERN)
    }
  })
})

describe('genShortRandomCode', () => {
  test('should generate a code in the format XXX-XXX', async () => {
    const code = await genShortRandomCode()
    expect(code).toMatch(SHORT_RANDOM_CODE_PATTERN)
  })

  test('should generate different codes on subsequent calls', async () => {
    const code1 = await genShortRandomCode()
    const code2 = await genShortRandomCode()
    expect(code1).not.toBe(code2)
  })

  test('should generate codes with only valid letters', async () => {
    const codes = await Promise.all(new Array(2000).fill(0).map(() => genShortRandomCode()))
    for (const code of codes) {
      expect(code).toMatch(SHORT_RANDOM_CODE_PATTERN)
    }
  })
})
