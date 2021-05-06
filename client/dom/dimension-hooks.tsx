import { ObservedElement, useResizeObserver } from '@envato/react-resize-observer-hook'
import { useCallback, useLayoutEffect, useRef, useState } from 'react'

export type DimensionsHookResult = [
  ref: (instance: ObservedElement | null) => void,
  contentRect?: DOMRectReadOnly,
]

/**
 * A hook that returns the current width/height for an element. Included in the return value is a
 * `ref` that must be attached to the element you wish to measure. A ResizeObserver will be attached
 * to the `ref'd` element and return new dimension values when it changes.
 *
 * Note that although this returns a `DomRect`, only the width and height are really meaningful. If
 * you need a position, you may want to consider `useElementRect` (either instead of this, or in
 * addition to this).
 */
export function useObservedDimensions(): DimensionsHookResult {
  const [ref, observedEntry] = useResizeObserver()
  return [ref, observedEntry?.contentRect]
}

/**
 * A hook that returns the current bounding client rect for an element. This hook does not observe
 * changes to this rect, so it will only be updated on re-render. (If you want to recalculate this
 * whenever the element is resized, you could combine this with `useObservedDimensions`)
 *
 * @returns a tuple of [a ref to apply to the element to get the bounding client rect for, the
 *   last bounding client rect (or undefined if one has not been calculated yet)]
 */
export function useElementRect(): [
  ref: (instance: HTMLElement | null) => void,
  rect: DOMRectReadOnly | undefined,
] {
  const elementRef = useRef<HTMLElement | null>(null)
  const [rect, setRect] = useState<DOMRectReadOnly>()

  const updateRect = useCallback((elem: HTMLElement) => {
    setRect(rect => {
      const newRect = elem.getBoundingClientRect()
      if (
        rect &&
        newRect.left === rect.left &&
        newRect.top === rect.top &&
        newRect.right === rect.right &&
        newRect.bottom === rect.bottom
      ) {
        return rect
      } else {
        return newRect
      }
    })
  }, [])
  const setElementRef = useCallback(
    (elem: HTMLElement | null) => {
      if (elementRef.current === elem) {
        return
      }

      if (elem) {
        updateRect(elem)
      }

      elementRef.current = elem
    },
    [updateRect],
  )

  // NOTE(tec27): This won't cause an infinite chain of updates because the state will only be
  // changed if the bounds change (or the element ref changes)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    if (elementRef.current) {
      updateRect(elementRef.current)
    } else {
      setRect(undefined)
    }
  })

  return [setElementRef, rect]
}
