import { RefObject, useLayoutEffect, useRef } from 'react'
import { useValueAsRef } from '../state-hooks'

/**
 * A React hook that creates an external (outside the React root) element on mount and returns a ref
 * to it. This is generaly useful for `ReactDOM.createPortal` usage.
 *
 * @params createCb an optional callback that will be called with the element when it is created
 *   and attached to the document.
 */
export function useExternalElementRef(
  createCb?: (elem: HTMLDivElement) => void,
): RefObject<HTMLDivElement> {
  const elemRef = useRef<HTMLDivElement>(null)
  if (!elemRef.current) {
    elemRef.current = document.createElement('div')
  }
  const createCbRef = useValueAsRef(createCb)
  useLayoutEffect(() => {
    const elem = elemRef.current
    document.body.appendChild(elem!)
    if (createCbRef.current) {
      createCbRef.current(elem!)
    }

    return () => {
      document.body.removeChild(elem!)
    }
  }, [createCbRef])

  // NOTE(tec27): This cast is safe as this will have always been set to a non-null value before we
  // return it, and this makes it a far more usable value for consumers of this hook.
  return elemRef as RefObject<HTMLDivElement>
}
