import React, { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useValueAsRef } from '../state-hooks'

export type DimensionsHookResult<T extends Element> = [
  ref: React.RefCallback<T>,
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
export function useObservedDimensions<T extends Element>(): DimensionsHookResult<T> {
  const [ref, observerEntry] = useResizeObserver()
  return [ref, observerEntry?.contentRect]
}

type ResizeObserverHookCallback = (entry: ResizeObserverEntry) => void
// NOTE(tec27): Using multiple ResizeObservers seems to be a lot more expensive that using a single
// one to observe multiple elements, at least according to some casual googling. So instead of
// creating one for each hook, we lazily create a single one and use it for all of them.
let resizeObserver: ResizeObserver | undefined
const observedResizeElements = new WeakMap<Element, ResizeObserverHookCallback>()

function onResizeObserved(entries: ResizeObserverEntry[]) {
  for (const entry of entries) {
    const handler = observedResizeElements.get(entry.target)
    if (handler) {
      handler(entry)
    }
  }
}

export function useResizeObserver<T extends Element>(
  options: ResizeObserverOptions = {},
): [ref: React.RefCallback<T>, observerEntry: ResizeObserverEntry | undefined] {
  const [observerEntry, setObserverEntry] = useState<ResizeObserverEntry>()
  const observerEntryRef = useValueAsRef(observerEntry)

  const { box } = options
  const onResize = useCallback(
    (entry: ResizeObserverEntry) => {
      if (!observerEntryRef.current) {
        setObserverEntry(entry)
        return
      }

      const observerEntry = observerEntryRef.current
      let changed = false

      switch (box) {
        case 'border-box':
          changed = entry.borderBoxSize.some(
            (boxSize, i) =>
              boxSize.inlineSize !== observerEntry.borderBoxSize[i].inlineSize ||
              boxSize.blockSize !== observerEntry.borderBoxSize[i].blockSize,
          )
          break

        case 'content-box':
          changed = entry.contentBoxSize.some(
            (boxSize, i) =>
              boxSize.inlineSize !== observerEntry.contentBoxSize[i].inlineSize ||
              boxSize.blockSize !== observerEntry.contentBoxSize[i].blockSize,
          )
          break

        case 'device-pixel-content-box':
          changed = entry.devicePixelContentBoxSize.some(
            (boxSize, i) =>
              boxSize.inlineSize !== observerEntry.devicePixelContentBoxSize[i].inlineSize ||
              boxSize.blockSize !== observerEntry.devicePixelContentBoxSize[i].blockSize,
          )
          break

        default:
          changed =
            entry.contentRect.width !== observerEntry.contentRect.width ||
            entry.contentRect.height !== observerEntry.contentRect.height
          break
      }

      if (changed) {
        setObserverEntry(entry)
      }
    },
    [box, observerEntryRef],
  )

  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(onResizeObserved)
  }

  const ref = useRef<T>()
  const setRef = useCallback(
    (node: T | null) => {
      if (ref.current) {
        resizeObserver?.unobserve(ref.current)
        observedResizeElements.delete(ref.current)
      }

      if (node) {
        observedResizeElements.set(node, onResize)
        resizeObserver?.observe(node, options)
      }

      ref.current = node ?? undefined
    },
    [onResize, options],
  )

  return [setRef, observerEntry]
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
