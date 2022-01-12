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
