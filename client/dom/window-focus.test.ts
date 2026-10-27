import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { WindowFocusTracker } from './window-focus'

describe('client/dom/window-focus (browser)', () => {
  let hasFocus: boolean

  beforeEach(() => {
    ;(global as any).IS_ELECTRON = false
    vi.useFakeTimers()
    hasFocus = true
    vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus)
  })

  afterEach(() => {
    ;(global as any).IS_ELECTRON = true
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  test('follows the window losing and regaining focus', () => {
    const tracker = new WindowFocusTracker()
    const listener = vi.fn()
    tracker.addListener(listener)
    expect(tracker.isFocused()).toBe(true)

    hasFocus = false
    window.dispatchEvent(new Event('blur'))
    vi.runOnlyPendingTimers()
    expect(tracker.isFocused()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(false)

    hasFocus = true
    window.dispatchEvent(new Event('focus'))
    expect(tracker.isFocused()).toBe(true)
    expect(listener).toHaveBeenLastCalledWith(true)
  })

  test('stays focused while focus is in an iframe on the page, until the browser loses it', () => {
    const tracker = new WindowFocusTracker()
    const iframe = document.createElement('iframe')
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(iframe)

    window.dispatchEvent(new Event('blur'))
    vi.runOnlyPendingTimers()
    expect(tracker.isFocused()).toBe(true)

    // Nothing is dispatched to the page when the browser loses focus from inside an iframe.
    hasFocus = false
    vi.advanceTimersByTime(1000)
    expect(tracker.isFocused()).toBe(false)
  })
})
