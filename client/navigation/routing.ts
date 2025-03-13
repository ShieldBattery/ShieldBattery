import { StructuredCloneable } from 'type-fest'

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
export function replace(url: string | PathObject, state: StructuredCloneable = null) {
  const urlString = typeof url === 'string' ? url : makePathString(url)
  history.replaceState(state, '', urlString)
}

/**
 * Replaces the current back stack entry with one at the same URL but with an updated state value.
 */
export function replaceCurrentWithState(state: StructuredCloneable = null) {
  replace(window.location.pathname, state)
}

/**
 * Navigates to a new URL by pushing it to the history stack.
 */
export function push(url: string | PathObject, state: StructuredCloneable = null) {
  const urlString = typeof url === 'string' ? url : makePathString(url)
  history.pushState(state, '', urlString)
}

/**
 * Adds an entry to the back stack with the current URL but a new state value.
 */
export function pushCurrentWithState(state: StructuredCloneable = null) {
  push(window.location.pathname, state)
}
