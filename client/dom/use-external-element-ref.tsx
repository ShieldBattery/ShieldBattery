import { RefObject, useLayoutEffect, useMemo } from 'react'
import { useValueAsRef } from '../react/state-hooks'

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
  // NOTE(tec27): We manually construct a ref object here to that we don't violate the rules of
  // react and make react-compiler deopt (assigning a ref in render)
  const elemRef = useMemo<RefObject<HTMLDivElement>>(() => {
    return {
      current: document.createElement('div'),
    }
  }, [])

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
  }, [createCbRef, elemRef])

  return elemRef
}
