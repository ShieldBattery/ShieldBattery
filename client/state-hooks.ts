import React, { useEffect, useRef } from 'react'

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
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>()
  useEffect(() => {
    ref.current = value
  })
  return ref.current
}

/**
 * A hook to move a prop to a ref, so it can be used in `useCallback` and `useEffect` hooks, without
 * needing to specify it in the dependency arrays of those hooks, thus reducing the amount of times
 * those callbacks get recreated.
 *
 * @example
 *
 * export const CounterComponent = (props) => {
 *   const countRef = usePropAsRef(props.count)
 *   useEffect(() => {
 *     if (countRef.current === 5) {
 *       console.log('Count is 5!!!')
 *     } else {
 *       console.log('Count is not 5 :(')
 *     }
 *   }, [props.something])
 *   return <div>Prop: {props.count}, ref: {countRef.current}</div>
 * }
 */
export function usePropAsRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef<T>(value)
  ref.current = value

  return ref
}
