import { freeze, produce, Producer } from 'immer'
import React, { useCallback, useEffect, useInsertionEffect, useRef, useState } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { appendToMultimap } from '../../common/data-structures/maps'
import { getErrorStack } from '../../common/errors'
import { useSelfUser } from '../auth/auth-utils'
import logger from '../logging/logger'

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
  const ref = useRef<T>(undefined)
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
  const ref = useRef<T>(undefined)
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
export function useValueAsRef<T>(value: T): React.RefObject<T> {
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
 *
 * @deprecated Re-think the component structure, as this should basically never be necessary unless
 * you are misusing refs in render.
 */
export function useForceUpdate(): () => void {
  const [, forceUpdater] = useState<number>(0)
  return () => {
    forceUpdater(v => (v + 1) % Number.MAX_SAFE_INTEGER)
  }
}

/**
 * Wraps a function/callback so that it is identity-stable, even if it is recreated across
 * different renders. This is useful for functions that depend on current props/state, but are used
 * as event handlers on their children.
 *
 * This is a not-completely-correct implementation of React's proposed `useEvent` hook, as described
 * here: https://github.com/reactjs/rfcs/blob/useevent/text/0000-useevent.md
 *
 * It differs in the following ways (and you should avoid causing any behavior that differs as a
 * result of these, so we can easily migrate in the future):
 *
 * - It doesn't throw if the stable callback is called during non-initial rendering
 * - The current function value gets swapped slightly later than React's future version
 */
export function useStableCallback<A extends any[], R>(fn: (...args: A) => R): (...args: A) => R {
  const updatedRef = useRef<(...args: A) => R>(initStableCallbackValue as any)
  useInsertionEffect(() => {
    updatedRef.current = fn
  })

  const [stableCallback] = useState(
    () =>
      (...args: A) =>
        updatedRef.current(...args),
  )

  return stableCallback
}

function initStableCallbackValue() {
  throw new Error(
    "useStableCallback was called before component was mounted, don't use this hook for " +
      'callbacks that are called during render',
  )
}

/**
 * Similar to the `useState` hook, but using immer under the hood which allows you to provide a
 * producer function in the setter to change the state in an immutable way. Mostly useful if you
 * want to use Map or Set as state.
 *
 * If you pass a non-function value to the setter, this hook behaves the same as `useState` and just
 * updates the state with that value.
 */
export function useImmerState<T>(
  initialState: (() => T) | T,
): [ReadonlyDeep<T>, (updater: Producer<T> | T) => void] {
  const [value, setValue] = useState<ReadonlyDeep<T>>(
    () =>
      freeze(
        initialState instanceof Function ? initialState() : initialState,
        true,
      ) as ReadonlyDeep<T>,
  )
  return [
    value,
    useCallback((updater: Producer<T> | T) => {
      if (updater instanceof Function) {
        setValue(v => produce(v, updater))
      } else {
        setValue(freeze(updater) as ReadonlyDeep<T>)
      }
    }, []),
  ]
}

/**
 * A mapping of localStorage key -> change listener. This is used to notify any hooks that are
 * watching a localStorage key within the same tab (this browsing context) so if some other
 * component changes the value, we can re-render every other component using the value.
 */
const localStorageListeners = new Map<string, Array<() => void>>()

function loadAndParseLocalStorage(key: string): unknown {
  const valueJson = localStorage.getItem(key)
  if (valueJson === null) {
    return undefined
  }

  try {
    return JSON.parse(valueJson)
  } catch (err) {
    logger.error(`error parsing value for ${key}: ${getErrorStack(err)}`)
    return undefined
  }
}

/**
 * Hook that is similar to `useState` but the value is stored in `LocalStorage`, keyed by user ID.
 * T must be serializable to JSON. Parsing failures will be logged and act as if the value is unset.
 */
export function useUserLocalStorageValue<T>(
  key: string,
): [value: T | undefined, storeValue: (value: T | undefined) => void]

/**
 * Hook that is similar to `useState` but the value is stored in `LocalStorage`, keyed by user ID.
 * T must be serializable to JSON. Parsing failures will be logged and act as if the value is unset.
 * Any time the value is unset, `defaultValue` will be returned instead.
 */
export function useUserLocalStorageValue<T>(
  key: string,
  defaultValue: T,
  validate?: (value: unknown) => T | undefined,
): [value: T, storeValue: (value: T | undefined) => void]

export function useUserLocalStorageValue<T>(
  key: string,
  defaultValue?: T,
  validate?: (value: unknown) => T | undefined,
): [value: T | undefined, storeValue: (value: T | undefined) => void] {
  const currentUser = useSelfUser()?.id ?? 0
  const userKey = `${String(currentUser)}|${key}`

  const load = useCallback(() => {
    const parsed = loadAndParseLocalStorage(userKey)
    return validate ? validate(parsed) : (parsed as T | undefined)
  }, [userKey, validate])

  const [value, setValue] = useState(() => load())

  const storeValue = (newValue: T | undefined) => {
    if (newValue === undefined) {
      localStorage.removeItem(userKey)
    } else {
      localStorage.setItem(userKey, JSON.stringify(newValue))
    }
    setValue(newValue)

    const listeners = localStorageListeners.get(userKey) ?? []
    for (const listener of listeners) {
      listener()
    }
  }

  useEffect(() => {
    function handleChange() {
      setValue(load())
    }

    function handleStorageEvent(event: StorageEvent) {
      if (event.storageArea === localStorage && event.key === userKey) {
        setValue(load())
      }
    }

    window.addEventListener('storage', handleStorageEvent)
    appendToMultimap(localStorageListeners, userKey, handleChange)

    setValue(load())

    return () => {
      window.removeEventListener('storage', handleStorageEvent)

      const listeners = localStorageListeners.get(userKey)
      if (listeners) {
        const index = listeners.indexOf(handleChange)
        if (index >= 0) {
          if (listeners.length === 1) {
            localStorageListeners.delete(userKey)
          } else {
            listeners.splice(index, 1)
          }
        }
      }
    }
  }, [load, userKey])

  return [value ?? defaultValue, storeValue]
}
