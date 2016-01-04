import { replacePath } from 'redux-simple-router'

export function isLoggedIn(authState) {
  return authState.user && authState.user.name
}

export function redirectIfLoggedIn({ auth, location, dispatch }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath = (location && location.query && location.query.nextPath) || '/'
    dispatch(replacePath(nextPath, null))
    return true
  }

  return false
}
