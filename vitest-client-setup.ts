// Run before any client/ vitest tests, use to set up the environment with any necessary globals
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// This is just to stop prettier from stripping all the comments for some reason?
{
  // Generally this is what we want, as it maximizes the amount of code that can be run/tested. If you
  // want a particular test to run as if in a browser, you can set this differently in the test
  // probably
  ;(global as any).IS_ELECTRON = true

  // Because IS_ELECTRON is true and vitest runs under Node (where process.type !== 'renderer'),
  // common/ipc.ts treats the test environment as the Electron main process and evaluates
  // `require('electron')` at import time. The real `electron` package throws "Electron failed to
  // install correctly" if its binary isn't installed, which happens in CI (and would happen on any
  // machine without the binary downloaded). Setting ELECTRON_OVERRIDE_DIST_PATH makes electron's
  // entrypoint return a path string instead of throwing; we never actually use the value (ipcMain
  // ends up undefined, which is fine since tests don't drive real IPC).
  process.env.ELECTRON_OVERRIDE_DIST_PATH ??= '/nonexistent-electron-dist-for-tests'
  ;(global as any).__WEBPACK_ENV = {
    SB_SERVER: 'https://shieldbattery.net',
  }
  ;(global as any).fetch = vi.fn(() => Promise.reject(new Error('fetch is disabled in tests')))

  // Ensure consistent locale formatting in tests
  Object.defineProperty(window.navigator, 'language', {
    get: () => 'en-US',
    configurable: true,
  })

  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = 'en-US'
  }

  afterEach(() => {
    cleanup()
  })
}
