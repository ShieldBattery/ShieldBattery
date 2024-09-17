import logger from './lib/logging/logger.js'

let serverRoot: string | undefined = undefined

/** Sets the root path for this server process, under which all its files should be present. */
export function setServerRoot(path: string) {
  serverRoot = path
  logger.info(`Server root set to: ${path}`)
}

/**
 * Retrieves the current root path for this server process, under which all its files should be
 * present.
 *
 * Use this to retrieve paths to data files. For source files, use import.meta.dirname and relative
 * paths instead.
 */
export function getServerRoot(): string {
  if (serverRoot === undefined) {
    throw new Error('serverRoot retrieved before it was set')
  }

  return serverRoot
}
