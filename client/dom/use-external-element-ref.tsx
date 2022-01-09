import { useEffect, useRef } from 'react'
import { useValueAsRef } from '../state-hooks'

/**
 * A React hook that creates an external (outside the React root) element on mount and returns a ref
 * to it. This is generaly useful for `ReactDOM.createPortal` usage.
 *
 * @params createCb an optional callback that will be called with the element when it is created
 *   and attached to the document.
 */
export function useExternalElementRef(createCb?: (elem: HTMLDivElement) => void) {
  const elemRef = useRef(document.createElement('div'))
  const createCbRef = useValueAsRef(createCb)
  useEffect(() => {
    const elem = elemRef.current
    document.body.appendChild(elem)
    if (createCbRef.current) {
      createCbRef.current(elem)
    }

    return () => {
      document.body.removeChild(elem)
    }
  }, [createCbRef])

  return elemRef
}
