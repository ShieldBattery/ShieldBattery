// Returns an absolute server URL for a path, if necessary (if running in Electron). If it's not
// necessary (in the browser), the path will be returned unmodified
export function makeServerUrl(path) {
  if (process.env.SB_ENV === 'web') {
    return path
  }

  const slashedPath = (path.length === 0 || path.startsWith('/') ? '' : '/') + path
  // TODO(tec27): let [advanced] users configure URLs
  return process.env.NODE_ENV === 'production' ?
      ('https://shieldbattery.net' + slashedPath) :
      ('http://localhost:5555' + slashedPath)
}
