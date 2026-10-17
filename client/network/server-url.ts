import { getServerConfig } from '../server-config-storage'
import { baseUrl } from './server-base-url'

/**
 * Returns an absolute server URL for a path, if necessary (if running in Electron). If it's not
 * necessary (in the browser), the path will be returned unmodified.
 */
export function makeServerUrl(path: string) {
  if (!IS_ELECTRON) {
    return path
  }

  const slashedPath = (path.length === 0 || path.startsWith('/') ? '' : '/') + path
  return baseUrl + slashedPath
}

/**
 * Returns an absolute URL for a path on server-rs, which serves the GraphQL API and some HTTP
 * endpoints from the server config's `graphqlOrigin`. Construct `path` with `urlPath` so any
 * variable parts are encoded.
 */
export function makeServerRsUrl(path: string) {
  return new URL(path, getServerConfig().graphqlOrigin).toString()
}

/**
 * Returns the current server origin, using either the current environment (Electron) or the current
 * location (browser).
 */
export function getServerOrigin() {
  if (!IS_ELECTRON) {
    return location.origin
  } else {
    return makeServerUrl('')
  }
}

/**
 * Returns an URL for a path that is supposed to be in a public assets directory. In case it's not
 * set (should be very rare), we default to our production server CDN.
 */
export function makePublicAssetUrl(path: string) {
  const slashlessPath = path.startsWith('/') ? path.substring(1) : '' + path
  const publicAssetsUrl = getServerConfig().publicAssetsUrl
  if (publicAssetsUrl) {
    return publicAssetsUrl + slashlessPath
  } else {
    return 'https://cdn.shieldbattery.net/public/' + slashlessPath
  }
}
