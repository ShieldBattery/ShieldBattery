import { useLocationProperty } from 'wouter/use-location'
import { useStableCallback } from '../state-hooks'
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
