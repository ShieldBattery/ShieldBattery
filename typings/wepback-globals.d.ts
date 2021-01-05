// Types for globals that we add with webpack

// TODO(tec27): Could probably type this more strictly
declare const __WEBPACK_ENV: Readonly<{
  SB_SERVER: string | undefined
  NODE_ENV: string
  VERSION: string
}>
declare const IS_ELECTRON: boolean
