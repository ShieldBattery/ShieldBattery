import { describe, expect, test } from 'vitest'
import { hideToTray, showWindow, TrayWindow } from './tray-window'

/** A window that keeps its state the way Windows does, recording each call made on it. */
function fakeWindow(maximized: boolean) {
  const calls: string[] = []
  const state = { visible: true, minimized: false, maximized }
  const window: TrayWindow = {
    isMaximized: () => state.maximized,
    isMinimized: () => state.minimized,
    minimize: () => {
      calls.push('minimize')
      state.minimized = true
    },
    maximize: () => {
      calls.push('maximize')
      state.visible = true
      state.minimized = false
      state.maximized = true
    },
    restore: () => {
      calls.push('restore')
      state.minimized = false
    },
    hide: () => {
      calls.push('hide')
      state.visible = false
    },
    show: () => {
      calls.push('show')
      state.visible = true
    },
    focus: () => {
      calls.push('focus')
    },
  }
  return { window, calls, state }
}

describe('tray-window', () => {
  test('goes to the tray minimized', () => {
    const { window, calls, state } = fakeWindow(false)
    hideToTray(window)
    expect(calls).toEqual(['minimize', 'hide'])
    expect(state).toEqual({ visible: false, minimized: true, maximized: false })
    showWindow(window)
  })

  test('a window at its normal size comes back from the tray restored', () => {
    const { window, calls, state } = fakeWindow(false)
    hideToTray(window)
    calls.length = 0
    showWindow(window)
    expect(calls).toEqual(['show', 'restore'])
    expect(state.minimized).toBe(false)
  })

  test('a maximized window comes back from the tray maximized, without showing first', () => {
    const { window, calls, state } = fakeWindow(true)
    hideToTray(window)
    calls.length = 0
    showWindow(window)
    expect(calls).toEqual(['maximize', 'focus'])
    expect(state).toEqual({ visible: true, minimized: false, maximized: true })
  })

  test('only the next showing after the tray maximizes', () => {
    const { window, calls } = fakeWindow(true)
    hideToTray(window)
    showWindow(window)
    calls.length = 0
    showWindow(window)
    expect(calls).toEqual(['show'])
  })
})
