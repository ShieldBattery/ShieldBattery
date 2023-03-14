import queryString from 'query-string'
import { makePathString, replace } from '../navigation/routing'

export function isLoggedIn(authState: { user?: { name?: string } }) {
  return authState.user && authState.user.name
}

export function redirectIfLoggedIn({ auth }: { auth: { user?: { name?: string } } }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath =
      location && location.search ? queryString.parse(location.search).nextPath ?? '/' : '/'
    replace(Array.isArray(nextPath) ? nextPath[0] ?? '/' : nextPath)
    return true
  }

  return false
}

export function createNextPath(location: Location) {
  return queryString.stringify({
    nextPath: makePathString({
      pathname: location.pathname,
      search: location.search,
    }),
  })
}

/**
 * Replaces the current page with the login page, including a query string to redirect back to this
 * page after login.
 */
export function redirectToLogin(navigateFn = replace) {
  const nextPath = createNextPath(location)
  navigateFn(`/login?${nextPath}`)
}
