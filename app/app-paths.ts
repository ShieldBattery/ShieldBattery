import path from 'node:path'

/**
 * Root of the app tree: the parent of the directory the bundles run from.
 *
 * Everything built (main, preload, the replay DB worker, the renderer and its shell) lives in one
 * directory, and the packager copies that directory rather than flattening it, so this resolves to
 * the same place during development as it does in an installed client. `assets/` sits beside it.
 */
export const APP_ROOT = path.join(__dirname, '..')
