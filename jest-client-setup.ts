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
;(global as any).ResizeObserver = jest.fn(() => ({
  observe: jest.fn(),
  disconnect: jest.fn(),
  unobserve: jest.fn(),
}))

// Ensure consistent locale formatting in tests
Object.defineProperty(window.navigator, 'language', {
  get: () => 'en-US',
  configurable: true,
})
