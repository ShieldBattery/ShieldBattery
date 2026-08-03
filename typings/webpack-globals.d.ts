// Types for globals the client builds define

// TODO(tec27): Could probably type this more strictly
declare const __WEBPACK_ENV: Readonly<{
  SB_ANALYTICS_ID: string | undefined
  SB_SERVER: string | undefined
  NODE_ENV: string
  VERSION: string
}>
declare const IS_ELECTRON: boolean

/** Fathom site id, baked in by the Electron main process build. Empty when none is configured. */
declare const SB_ANALYTICS_ID: string
