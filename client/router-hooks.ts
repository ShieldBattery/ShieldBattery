import { useLocation } from 'wouter'

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
  const [location, setLocation] = useLocation()
  const searchParams = new URLSearchParams(window.location.search)
  const searchValue = searchParams.get(name) ?? ''

  const setLocationSearch = (value: string) => {
    const params = new URLSearchParams(Array.from(searchParams.entries()))
    if (value) {
      params.set(name, value)
    } else {
      params.delete(name)
    }

    const searchString = params.toString()
    setLocation(location + (searchString ? `?${searchString}` : ''))
  }

  return [searchValue, setLocationSearch]
}
