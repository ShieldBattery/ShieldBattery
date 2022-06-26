import { useResizeObserver } from './dimension-hooks'

/**
 * A hook that will measure a specific element on a resize and return whether the element is
 * overflowing its bounding box.
 *
 * This is mainly useful for things like measuring if the text is oveflowing (e.g. is it showing
 * elipsis) and then showing the full text in a tooltip or something.
 */
export function useOverflowingElement<T extends HTMLElement>(): [
  ref: React.RefCallback<T>,
  isElementOverflowing: boolean,
] {
  const [ref, observerEntry] = useResizeObserver()
  const target = observerEntry?.target as HTMLElement | undefined

  let isOverflowing = false
  if (target) {
    isOverflowing = target.offsetWidth < target.scrollWidth
  }

  return [ref, isOverflowing]
}
