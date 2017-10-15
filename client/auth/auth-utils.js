import { routerActions } from 'react-router-redux'
import queryString from 'query-string'

export function isLoggedIn(authState) {
  return authState.user && authState.user.name
}

export function redirectIfLoggedIn({ auth, location, dispatch }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath = location && location.search ? queryString.parse(location.search).nextPath : '/'
    dispatch(routerActions.replace(nextPath))
    return true
  }

  return false
}
