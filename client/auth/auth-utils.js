export function isLoggedIn(authState) {
  return !!authState.get('user')
}

export function redirectIfLoggedIn({ auth, router }, contextRouter) {
  if (isLoggedIn(auth)) {
    // We're logged in now, hooray!
    // Go wherever the user was intending to go before being directed here (or home)
    const nextPath =
        (router.location && router.location.query && router.location.query.nextPath) || '/'
    contextRouter.replaceWith(nextPath)
    return true
  }

  return false
}
