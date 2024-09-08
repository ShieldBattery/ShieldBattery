import queryString from 'query-string'
import { useEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { SbPermissions } from '../../common/users/permissions'
import { SelfUser } from '../../common/users/sb-user'
import { makePathString, replace } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'

/** Redirects to the current `nextPath` query string parameter once the client has logged in. */
export function useRedirectAfterLogin() {
  const isLoggedIn = useIsLoggedIn()
  useEffect(() => {
    if (isLoggedIn) {
      const nextPath =
        location && location.search ? (queryString.parse(location.search).nextPath ?? '/') : '/'
      replace(Array.isArray(nextPath) ? (nextPath[0] ?? '/') : nextPath)
    }
  }, [isLoggedIn])
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

/**
 * A React hook that returns whether or not the client is logged in.
 */
export function useIsLoggedIn(): boolean {
  return useAppSelector(s => Boolean(s.auth.self))
}

/** A hook that returns the user that is currently logged in to this client. */
export function useSelfUser(): ReadonlyDeep<SelfUser> | undefined {
  return useAppSelector(s => s.auth.self?.user)
}

/** A hook that returns the permissions of the currently logged in user. */
export function useSelfPermissions(): ReadonlyDeep<SbPermissions> | undefined {
  return useAppSelector(s => s.auth.self?.permissions)
}
