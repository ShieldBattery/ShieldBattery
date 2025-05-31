// Run before any client/ Jest tests, use to set up the environment with any necessary globals

// Generally this is what we want, as it maximizes the amount of code that can be run/tested. If you
// want a particular test to run as if in a browser, you can set this differently in the test
// probably
;(global as any).IS_ELECTRON = true
;(global as any).__WEBPACK_ENV = {
  SB_SERVER: 'https://shieldbattery.net',
}
;(global as any).fetch = jest.fn(() => Promise.reject(new Error('fetch is disabled in tests')))

// Ensure consistent locale formatting in tests
Object.defineProperty(window.navigator, 'language', {
  get: () => 'en-US',
  configurable: true,
})
