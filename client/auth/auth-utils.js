import { routeActions } from 'redux-simple-router'

export function isLoggedIn(authState) {
  return authState.user && authState.user.name
}

export function redirectIfLoggedIn({ auth, location, dispatch }) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath = (location && location.query && location.query.nextPath) || '/'
    dispatch(routeActions.replace(nextPath))
    return true
  }

  return false
}

export function redirectToLogin(props, transitionFn = routeActions.push) {
  return (dispatch, getState) => {
    const { history, location: loc } = props
    const query = {
      nextPath: history.createPath(loc.pathname, loc.query)
    }
    dispatch(transitionFn({ pathname: '/login', query }))
  }
}
