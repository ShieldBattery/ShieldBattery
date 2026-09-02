import { describe, expect, test } from 'vitest'
import { MAX_DATE_MILLIS, joiTimestampMillis } from './joi-timestamp'

describe('server/lib/validation/joi-timestamp', () => {
  test('accepts the largest instant a Date can represent', () => {
    expect(joiTimestampMillis().validate(MAX_DATE_MILLIS).error).toBeUndefined()
  })

  test('the accepted upper bound converts to a valid Date', () => {
    const { error, value } = joiTimestampMillis().validate(MAX_DATE_MILLIS)

    expect(error).toBeUndefined()
    expect(Number.isNaN(new Date(value).getTime())).toBe(false)
  })

  test('rejects a value one millisecond past what a Date can represent', () => {
    expect(joiTimestampMillis().validate(MAX_DATE_MILLIS + 1).error).toBeDefined()
  })

  test('rejects Infinity', () => {
    expect(joiTimestampMillis().validate(Infinity).error).toBeDefined()
  })

  test('a lower bound chained by the caller still applies', () => {
    const schema = joiTimestampMillis().min(-1)

    expect(schema.validate(-1).error).toBeUndefined()
    expect(schema.validate(-2).error).toBeDefined()
  })

  test('a lower bound chained by the caller does not drop the upper bound', () => {
    expect(
      joiTimestampMillis()
        .min(-1)
        .validate(MAX_DATE_MILLIS + 1).error,
    ).toBeDefined()
  })
})
