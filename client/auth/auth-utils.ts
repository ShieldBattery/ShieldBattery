import { useEffect, useLayoutEffect } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { SbPermissions } from '../../common/users/permissions'
import { SelfUserJson } from '../../common/users/sb-user'
import logger from '../logging/logger'
import { makePathString, replace } from '../navigation/routing'
import { useAppSelector } from '../redux-hooks'

// Tracks if we're in the process of redirecting after login so that having multiple
// `useRedirectAfterLogin` hooks rendered (or being in strict mode in dev) doesn't cause issues
const IS_REDIRECTING_AFTER_LOGIN = { value: false }

/** Redirects to the current `nextPath` query string parameter once the client has logged in. */
export function useRedirectAfterLogin() {
  const isLoggedIn = useIsLoggedIn()
  useEffect(() => {
    if (isLoggedIn && !IS_REDIRECTING_AFTER_LOGIN.value) {
      IS_REDIRECTING_AFTER_LOGIN.value = true

      const params = new URLSearchParams(location.search)
      let nextPath = params.get('nextPath')
      // If we have nested nextPaths, get the deepest one
      while (nextPath) {
        try {
          const nextUrl = new URL(nextPath, location.origin)
          const nextParams = new URLSearchParams(nextUrl.search)
          if (nextParams.has('nextPath')) {
            nextPath = nextParams.get('nextPath')
          } else {
            break
          }
        } catch (err) {
          logger.error('Error determining next path after login: ' + getErrorStack(err))
          break
        }
      }
      replace(nextPath ?? '/')

      queueMicrotask(() => {
        IS_REDIRECTING_AFTER_LOGIN.value = false
      })
    }
  }, [isLoggedIn])
}

function createNextPath(location: Location): string | undefined {
  const params = new URLSearchParams()
  params.append(
    'nextPath',
    makePathString({
      pathname: location.pathname,
      search: location.search,
    }),
  )
  return params.toString()
}

/**
 * Replaces the current page with the login page, including a query string to redirect back to this
 * page after login. Only use this inside of event callbacks, do *not* call it during render. See
 * `useRequiresLogin` for a render-safe alternative.
 */
export function redirectToLogin(navigateFn = replace) {
  const nextPath = createNextPath(location)
  navigateFn(`/login?${nextPath}`)
}

// Tracks if we're currently redirecting to the login page so we don't do it multiple times within
// the same render (I think this mostly happens because of strict mode, but theoretically it could
// happen for other reasons as well).
const IS_SENDING_TO_LOGIN = { value: false }

/**
 * A hook that redirects to the login page if the user is not logged in. Returns true if the
 * redirect is occurring (so the component should probably render nothing).
 */
export function useRequireLogin(): boolean {
  const isLoggedIn = useIsLoggedIn()
  const needsRedirect = !isLoggedIn && !IS_SENDING_TO_LOGIN.value

  useLayoutEffect(() => {
    if (!needsRedirect || IS_SENDING_TO_LOGIN.value) {
      return
    }

    IS_SENDING_TO_LOGIN.value = true
    redirectToLogin()
    queueMicrotask(() => {
      IS_SENDING_TO_LOGIN.value = false
    })
  }, [needsRedirect])

  return !isLoggedIn
}

/**
 * A React hook that returns whether or not the client is logged in.
 */
export function useIsLoggedIn(): boolean {
  return useAppSelector(s => Boolean(s.auth.self))
}

/** A hook that returns the user that is currently logged in to this client. */
export function useSelfUser(): ReadonlyDeep<SelfUserJson> | undefined {
  return useAppSelector(s => s.auth.self?.user)
}

/** A hook that returns the permissions of the currently logged in user. */
export function useSelfPermissions(): ReadonlyDeep<SbPermissions> | undefined {
  return useAppSelector(s => s.auth.self?.permissions)
}
