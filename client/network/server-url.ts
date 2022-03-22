import { JsonLocalStorageValue } from '../local-storage'

const baseUrl =
  IS_ELECTRON && (window as any).SHIELDBATTERY_ELECTRON_API?.env?.SB_SERVER
    ? (window as any).SHIELDBATTERY_ELECTRON_API.env.SB_SERVER
    : __WEBPACK_ENV.SB_SERVER

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
  const serverOrigin = getServerOrigin().toLowerCase()
  const publicAssetsUrl = new JsonLocalStorageValue<string>(`${serverOrigin}:publicAssetsUrl`)
  if (publicAssetsUrl) {
    return publicAssetsUrl.getValue() + path
  } else {
    return 'cdn.shieldbattery.net/public' + path
  }
}
