import { useEffect, useRef } from 'react'

/**
 * A React hook that creates an external (outside the React root) element on mount and returns a ref
 * to it. This is generaly useful for `ReactDOM.createPortal` usage.
 */
export function useExternalElementRef() {
  const elemRef = useRef(document.createElement('div'))
  useEffect(() => {
    const elem = elemRef.current
    document.body.appendChild(elem)

    return () => {
      document.body.removeChild(elem)
    }
  }, [])

  return elemRef
}
