import { ObservedElement, useResizeObserver } from '@envato/react-resize-observer-hook'

export type DimensionsHookResult = [
  ref: (instance: ObservedElement | null) => void,
  contentRect?: DOMRectReadOnly,
]

/**
 * A hook that returns the current width/height for an element. Included in the return value is a
 * `ref` that must be attached to the element you wish to measure. A ResizeObserver will be attached
 * to the `ref'd` element and return new dimension values when it changes.
 */
export function useDimensions(): DimensionsHookResult {
  const [ref, observedEntry] = useResizeObserver()
  return [ref, observedEntry?.contentRect]
}
