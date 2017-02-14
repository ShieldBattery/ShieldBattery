const baseUrl = process.env.SB_SERVER ? process.env.SB_SERVER : process.webpackEnv.SB_SERVER

// Returns an absolute server URL for a path, if necessary (if running in Electron). If it's not
// necessary (in the browser), the path will be returned unmodified
export function makeServerUrl(path) {
  if (process.webpackEnv.SB_ENV === 'web') {
    return path
  }

  const slashedPath = (path.length === 0 || path.startsWith('/') ? '' : '/') + path
  return baseUrl + slashedPath
}
