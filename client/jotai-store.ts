import { createStore } from 'jotai'
// jotai-devtools wraps `createStore` with a top-level call, so we need to ensure this gets
// imported before we create the store. Webpack will ensure this only gets imported in dev builds
import { DevTools } from 'jotai-devtools'

if (__WEBPACK_ENV.NODE_ENV !== 'production' && !DevTools) {
  // This shouldn't ever happen, we just need to convince prettier not to remove the import and
  // doing a bare import gets stripped by webpack because I guess it assumes the import is pure?
  console.log('jotai-devtools not found!!!')
}

export const jotaiStore = createStore()
