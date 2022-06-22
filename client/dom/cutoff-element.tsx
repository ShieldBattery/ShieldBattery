import { useLayoutEffect, useState } from 'react'
import { useWindowListener } from './window-listener'

/**
 * A hook that will measure a specific element on a resize and return whether the element is cutoff.
 * A cutoff element is an element whose bounding box exceeds its visible size.
 *
 * This is mainly useful for things like measuring if the text is cutoff (e.g. is it showing
 * elipsis) and then showing the full text in a tooltip or something.
 */
export function useCutoffElement(measuredElement: HTMLElement | null): boolean {
  const [isCutoff, setIsCutoff] = useState(false)

  useLayoutEffect(() => {
    if (measuredElement) {
      setIsCutoff(measuredElement.offsetWidth < measuredElement.scrollWidth)
    }
  }, [measuredElement])
  useWindowListener('resize', () => {
    if (measuredElement) {
      setIsCutoff(measuredElement.offsetWidth < measuredElement.scrollWidth)
    }
  })

  return isCutoff
}
