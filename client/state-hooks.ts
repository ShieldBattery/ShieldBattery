import React, { useEffect, useRef } from 'react'

/**
 * A hook to access the previous value of some variable inside a functional component.
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
 * A hook that returns the last value for a variable that was not `undefined`. If no such value has
 * been seen yet, `undefined` will be returned.
 */
export function usePreviousDefined<T>(value: T | undefined): T | undefined {
  const ref = useRef<T>()
  useEffect(() => {
    if (value !== undefined) {
      ref.current = value
    }
  })

  return ref.current
}

/**
 * A hook which allows the callbacks and effects to access the current value of a prop or state
 * field without needing to be re-run/re-created.
 *
 * @example
 *
 * export const CounterComponent = (props) => {
 *   const countRef = usePropAsRef(props.count)
 *   const onClick = useCallback(() => console.log('Count: ' + countRef.current), [])
 *   return <button title='Count' onClick={onClick} />
 * }
 */
export function useValueAsRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value

  return ref
}
