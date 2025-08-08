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
): Ref<T> | undefined {
  const definedRefs = refs.filter(r => r !== undefined)
  if (definedRefs.length === 0) {
    return () => {}
  } else if (definedRefs.length === 1) {
    return definedRefs[0]
  }

  return (value: T) => {
    const callbacks: Array<() => void> = []
    for (const ref of definedRefs) {
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
