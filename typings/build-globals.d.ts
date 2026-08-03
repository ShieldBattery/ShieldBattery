// Types for globals the builds define. Values that only the browser-targeting builds need live on
// `import.meta.env` instead (see vite-client.d.ts); these are here because the Electron main
// process reads them too, and that bundle is CommonJS with no `import.meta` to read from.

declare const IS_ELECTRON: boolean

/** Fathom site id, baked in by the Electron main process build. Empty when none is configured. */
declare const SB_ANALYTICS_ID: string
