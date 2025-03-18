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
