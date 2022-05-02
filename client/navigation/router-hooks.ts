import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { push } from './routing'

const events = ['popstate', 'pushState', 'replaceState', 'hashchange']
function subscribe(callback: () => void) {
  for (const event of events) {
    window.addEventListener(event, callback)
  }
  return () => {
    for (const event of events) {
      window.removeEventListener(event, callback)
    }
  }
}

/**
 * A hook which utilizes `useSyncExternalStore` hook to subscribe to the location changes, and
 * returns a memoized URL of the current location. Unlike wouter's `useLocation` hook, which returns
 * just a location pathname without the search params, this hook returns the whole `URL` object
 * including the search params.
 */
export function useUrl(): URL {
  const location = useSyncExternalStore(subscribe, () => window.location)
  return useMemo(() => new URL(location.href), [location.href])
}

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
): [value: string, setValue: (value: string) => void] => {
  const url = useUrl()
  const searchParams = url.searchParams
  const searchValue = searchParams.get(name) ?? ''

  const setLocationSearch = useCallback(
    (value: string) => {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      if (value) {
        params.set(name, value)
      } else {
        params.delete(name)
      }

      const searchString = params.toString()
      push(url.pathname + (searchString ? `?${searchString}` : ''))
    },
    [name, searchParams, url.pathname],
  )

  return [searchValue, setLocationSearch]
}
