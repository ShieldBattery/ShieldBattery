import { RefObject, useLayoutEffect } from 'react'
import { useLocation } from 'wouter'
import { useLocationProperty } from 'wouter/use-browser-location'
import { useStableCallback } from '../react/state-hooks'
import { replace } from './routing'

/**
 * A hook that reads a search param with a given name from `window.location`, and allows changing
 * it. Changing the search param will re-render the component.
 *
 * If there are multiple params with the same name (which is apparently supported by the standard),
 * we return the first one.
 *
 * @example
 *
 * export const UserList = () => {
 *   // /users?page=3
 *   const [page, setPage] = useLocationSearchParam('page')
 *   console.log(page) // '3'
 *   return <button onClick={() => setPage('4')}>Go to page 4</button>
 * }
 */
export const useLocationSearchParam = (
  name: string,
  transitionFn = replace,
): [value: string, setValue: (value: string) => void] => {
  const searchValue =
    useLocationProperty(() => new URLSearchParams(window.location.search).get(name)) ?? ''

  const setLocationSearch = useStableCallback((value: string) => {
    const searchParams = new URLSearchParams(window.location.search)
    if (value) {
      searchParams.set(name, value)
    } else {
      searchParams.delete(name)
    }

    const searchString = searchParams.toString()
    transitionFn(window.location.pathname + (searchString ? `?${searchString}` : ''))
  })

  return [searchValue, setLocationSearch]
}

/**
 * Resets an element's scroll position to the top whenever the current location's pathname changes.
 * This runs pre-paint, so the user never sees the intermediate scrolled state. Intended for
 * scrollable containers that stay mounted across navigations (e.g. route containers that are keyed
 * by route pattern and thus reused when moving between two locations matching the same pattern),
 * which would otherwise carry the previous page's scroll position over to the new page.
 *
 * Changes to the URL's search params alone don't trigger a reset, so components using the URL as
 * state (e.g. `useLocationSearchParam`) can update it freely without scrolling their page.
 */
export function useScrollResetOnNavigate(ref: RefObject<Element | null>): void {
  const [pathname] = useLocation()

  useLayoutEffect(() => {
    ref.current?.scrollTo(0, 0)
  }, [pathname, ref])
}
