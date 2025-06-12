// Run before any client/ vitest tests, use to set up the environment with any necessary globals
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// This is just to stop prettier from stripping all the comments for some reason?
{
  // Generally this is what we want, as it maximizes the amount of code that can be run/tested. If you
  // want a particular test to run as if in a browser, you can set this differently in the test
  // probably
  ;(global as any).IS_ELECTRON = true
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
