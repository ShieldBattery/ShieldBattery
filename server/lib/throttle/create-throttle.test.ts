import { describe, expect, test } from 'vitest'
import createThrottle from './create-throttle'

const VALID_RATE = 10
const VALID_BURST = 20
const VALID_WINDOW_MS = 60000

const validOptions = {
  rate: VALID_RATE,
  burst: VALID_BURST,
  window: VALID_WINDOW_MS,
}

describe('server/throttle/create-throttle', () => {
  test.each([
    ['rate', { ...validOptions, rate: 0 }],
    ['rate', { ...validOptions, rate: -1 }],
    ['rate', { ...validOptions, rate: Number.NaN }],
    ['rate', { ...validOptions, rate: Number.POSITIVE_INFINITY }],
    ['window', { ...validOptions, window: 0 }],
    ['window', { ...validOptions, window: -1 }],
    ['window', { ...validOptions, window: Number.NaN }],
    ['window', { ...validOptions, window: Number.POSITIVE_INFINITY }],
  ])('rejects a non-positive or non-finite %s', (option, options) => {
    expect(() => createThrottle('test', options)).toThrow(
      new RangeError(`Throttle ${option} must be a finite number greater than zero`),
    )
  })

  test('accepts valid options', () => {
    expect(() => createThrottle('test', validOptions)).not.toThrow()
  })
})
