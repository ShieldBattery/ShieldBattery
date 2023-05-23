export interface PathObject {
  pathname: string
  search?: string
  hash?: string
}

function ensurePrefixed(str: string, prefix: string) {
  return str.startsWith(prefix) ? str : prefix + str
}

/**
 * Converts a given object of the parts of a URL path into string form.
 */
export function makePathString(obj: PathObject) {
  const searchPart = obj.search ? ensurePrefixed(obj.search, '?') : ''
  const hashPart = obj.hash ? ensurePrefixed(obj.hash, '#') : ''
  return obj.pathname + searchPart + hashPart
}

/**
 * Navigates to a new URL by replacing the current one (so that no new back stack entry is added).
 */
export function replace(url: string | PathObject) {
  const urlString = typeof url === 'string' ? url : makePathString(url)
  history.replaceState(null, '', urlString)
}

/**
 * Navigates to a new URL by pushing it to the history stack.
 */
export function push(url: string | PathObject) {
  const urlString = typeof url === 'string' ? url : makePathString(url)
  history.pushState(null, '', urlString)
}
