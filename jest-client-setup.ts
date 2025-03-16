// Run before any client/ Jest tests, use to set up the environment with any necessary globals

// Generally this is what we want, as it maximizes the amount of code that can be run/tested. If you
// want a particular test to run as if in a browser, you can set this differently in the test
// probably
;(global as any).IS_ELECTRON = true
;(global as any).__WEBPACK_ENV = {
  SB_SERVER: 'https://shieldbattery.net',
}
// I dunno why these aren't available in the browser env :(
;(global as any).AudioContext = jest.fn(() => ({
  createGain: jest.fn(() => ({
    connect: jest.fn(),
  })),
  destination: {},
}))

// Ensure consistent timezone and time formatting in tests
process.env.TZ = 'UTC'
Object.defineProperty(window.navigator, 'language', {
  get: () => 'en-US',
  configurable: true,
})
