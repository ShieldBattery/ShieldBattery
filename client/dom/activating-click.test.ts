import { describe, expect, test } from 'vitest'
import { isActivatingClick } from './activating-click'

function dispatchAt(type: string, timeStamp: number) {
  const event = new Event(type)
  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  window.dispatchEvent(event)
}

describe('isActivatingClick', () => {
  test('is false for a press when the window has never gained focus', () => {
    dispatchAt('mousedown', 1000)

    expect(isActivatingClick()).toBe(false)
  })

  test('is true for a press right after the window gains focus', () => {
    dispatchAt('focus', 2000)
    dispatchAt('mousedown', 2002)

    expect(isActivatingClick()).toBe(true)
  })

  test('is true for a press that came just before the window gained focus', () => {
    dispatchAt('mousedown', 3000)
    dispatchAt('focus', 3002)

    expect(isActivatingClick()).toBe(true)
  })

  test('is false for a press long after the window gained focus', () => {
    dispatchAt('focus', 4000)
    dispatchAt('mousedown', 4500)

    expect(isActivatingClick()).toBe(false)
  })

  test('only the first press after gaining focus is activating', () => {
    dispatchAt('focus', 5000)
    dispatchAt('mousedown', 5002)
    dispatchAt('mousedown', 5400)

    expect(isActivatingClick()).toBe(false)
  })
})
