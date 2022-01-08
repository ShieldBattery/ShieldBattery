import { useEffect, useRef } from 'react'

/**
 * Returns a ref that, when attached to an element, causes that element to be focused after
 * `delayMillis` milliseconds.
 */
export function useAutoFocusRef<T extends { focus: () => void }>(delayMillis = 450) {
  const ref = useRef<T>(null)
  useEffect(() => {
    const timer = setTimeout(() => {
      ref.current?.focus()
    }, delayMillis)
    return () => {
      clearTimeout(timer)
    }
  }, [delayMillis])

  return ref
}
