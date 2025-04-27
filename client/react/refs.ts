import { Ref, RefCallback } from 'react'

export function assignRef<T>(
  ref: Ref<T> | undefined,
  value: T,
): ReturnType<RefCallback<T>> | undefined {
  if (typeof ref === 'function') {
    return ref(value)
  } else if (typeof ref === 'object' && ref !== null && 'current' in ref) {
    ref.current = value
  }

  return undefined
}

/**
 * Combines multiple refs into a single one.
 */
export function useMultiplexRef<T>(
  ...refs: Array<Ref<T> | Ref<T | null> | undefined>
): RefCallback<T> {
  return (value: T) => {
    const callbacks: Array<() => void> = []
    for (const ref of refs) {
      const cb = assignRef(ref, value)
      callbacks.push(cb ?? (() => assignRef(ref, null)))
    }

    return () => {
      for (const cb of callbacks) {
        cb()
      }
    }
  }
}
