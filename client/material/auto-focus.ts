import { useCallback, useEffect, useRef } from 'react'

/**
 * Returns a ref that, when attached to an element, causes that element to be focused after
 * `delayMillis` milliseconds.
 */
export function useAutoFocusRef<T extends { focus: () => void }>(delayMillis = 0) {
  const hasFocused = useRef<boolean>(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const ref = useRef<T>()
  const setRef = useCallback(
    (newRef: T) => {
      ref.current = newRef
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = undefined
      }

      if (newRef && !hasFocused.current) {
        timer.current = setTimeout(() => {
          if (ref.current) {
            ref.current.focus()
            hasFocused.current = true
          }
        }, delayMillis)
      }
    },
    [delayMillis],
  )

  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current)
      }
    }
  }, [])

  return setRef
}
