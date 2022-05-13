import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
 *   const countRef = useValueAsRef(props.count)
 *   const onClick = useCallback(() => console.log('Count: ' + countRef.current), [])
 *   return <button title='Count' onClick={onClick} />
 * }
 */
export function useValueAsRef<T>(value: T): React.MutableRefObject<T> {
  const ref = useRef(value)
  ref.current = value

  return ref
}

/**
 * Hook that returns a function which, when called, triggers a re-render of the current component.
 *
 * @example
 * export const UpdatingComponent = () => {
 *   const forceUpdate = useForceUpdate()
 *   return <span onClick={() => forceUpdate()}>Date: {new Date().toString()}</span>
 * }
 */
export function useForceUpdate(): () => void {
  const [, forceUpdater] = useState<Record<string, never>>()
  return useCallback(() => {
    forceUpdater({})
  }, [])
}

/**
 * A hook which multiplexes the given ref with a local one. Mostly useful when needing to create a
 * local ref in a component that already forwards a ref to another component below it.
 */
export function useMultiRef<T>(
  ref: React.ForwardedRef<T>,
): [elemRef: React.MutableRefObject<T | undefined>, setElemRef: (elem: T | null) => void] {
  const elemRef = useRef<T>()
  const setElemRef = useCallback(
    (elem: T | null) => {
      elemRef.current = elem ?? undefined
      if (ref) {
        if (typeof ref === 'function') {
          ref(elem)
        } else {
          ref.current = elem
        }
      }
    },
    [ref],
  )

  return [elemRef, setElemRef]
}

/**
 * Wraps a function/callback so that it is identity-stable, even if it is recreated across
 * different renders. This is useful for functions that depend on current props/state, but are used
 * as event handlers on their children.
 *
 * This is a not-completely-correct implementation of React's future `useEvent` hook, as described
 * here: https://github.com/reactjs/rfcs/blob/useevent/text/0000-useevent.md
 *
 * It differs in the following ways (and you should avoid causing any behavior that differs as a
 * result of these, so we can easily migrate in the future):
 *
 * - It doesn't throw if the stable callback is called during rendering
 * - The current function value gets swapped slightly later than React's future version
 *
 * TODO(tec27): Replace with React's `useEvent` once it is available
 */
export function useStableCallback<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef<(...args: A) => R>(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  return useCallback((...args: A) => ref.current(...args), [])
}
