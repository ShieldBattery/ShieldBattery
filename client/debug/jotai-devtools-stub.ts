// Stands in for `jotai-devtools` in production builds, which the bundler aliases here so the
// (large, development-only) real package never ships. `client/jotai-store.ts` imports `DevTools`
// unconditionally because the real package patches `createStore` on import and so must be
// evaluated before the store is created; only the dev build needs that to do anything.
export const DevTools = undefined
