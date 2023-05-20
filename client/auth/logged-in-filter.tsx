import React from 'react'
import { Redirect } from 'wouter'
import { createNextPath, useIsLoggedIn } from './auth-utils'

export function LoggedInFilter({ children }: { children: JSX.Element }) {
  const isLoggedIn = useIsLoggedIn()

  if (!isLoggedIn) {
    const nextPath = createNextPath(location)
    return <Redirect to={`/login?${nextPath}`} />
  } else {
    return React.Children.only(children)
  }
}
