import { useEffect, useRef } from 'react'

// This file contains hooks that should really be a part of the react itself, but for some reason
// aren't. At least not yet.

/**
 * A hook to access the previous value of some variable inside a functional component. Can be used
 * for both props and state.
 *
 * @example
 *
 * export const CounterComponent = () => {
 *   const [count, setCount] = useState(0)
 *   const prevCount = usePrevious(count)
 *   return <div>Now: {count}, before: {prevCount}</div>
 * }
 */
export const usePrevious = <T>(value: T): T | undefined => {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  })
  return ref.current
}
