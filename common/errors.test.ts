import { describe, expect, test } from 'vitest'
import { getErrorStack } from './errors'

describe('common/errors/getErrorStack', () => {
  test('returns the stack of an Error', () => {
    const err = new Error('boom')
    expect(getErrorStack(err)).toBe(err.stack)
  })

  test('stringifies thrown strings (e.g. from WASM bindings)', () => {
    expect(getErrorStack('Failed to parse replay')).toBe('Failed to parse replay')
  })

  test('stringifies other primitives', () => {
    expect(getErrorStack(42)).toBe('42')
    expect(getErrorStack(undefined)).toBe('undefined')
    expect(getErrorStack(null)).toBe('null')
  })

  test('stringifies objects without a stack', () => {
    expect(getErrorStack({ message: 'no stack here' })).toBe('[object Object]')
  })
})
