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
 * A hook which allows the callbacks and effects to access the current value of the prop without
 * needing to be re-run/re-created.
 *
 * @example
 *
 * export const CounterComponent = (props) => {
 *   const countRef = usePropAsRef(props.count)
 *   const onClick = useCallback(() => console.log('Count: ' + countRef.current), [])
 *   return <button title='Count' onClick={onClick} />
 * }
 */
export function usePropAsRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value

  return ref
}
