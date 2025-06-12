import { describe, expect, test } from 'vitest'
import * as actions from './actions'

describe('actions', () => {
  test('should have matching keys and values', () => {
    for (const action of Object.keys(actions)) {
      expect((actions as any)[action]).toBe(action)
    }
  })
})
