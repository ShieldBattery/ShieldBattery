import { replace, makePathString } from '../navigation/routing'
import queryString from 'query-string'

export function isLoggedIn(authState) {
  return authState.user && authState.user.name
}

export function redirectIfLoggedIn({ auth }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath = location && location.search ? queryString.parse(location.search).nextPath : '/'
    replace(nextPath)
    return true
  }

  return false
}

export function createNextPath(location) {
  return queryString.stringify({
    nextPath: makePathString({
      pathname: location.pathname,
      search: location.search,
    }),
  })
}
