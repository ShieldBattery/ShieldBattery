import { replaceState } from 'redux-router'

export function isLoggedIn(authState) {
  return !!authState.get('user')
}

export function redirectIfLoggedIn({ auth, router, dispatch }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath =
        (router.location && router.location.query && router.location.query.nextPath) || '/'
    dispatch(replaceState(null, nextPath))
    return true
  }

  return false
}
