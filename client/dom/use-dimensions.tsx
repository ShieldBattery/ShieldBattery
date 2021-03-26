import { useLayoutEffect, useState } from 'react'
import { useWindowListener } from './window-listener'

/**
 * A hook that returns the current width of a target element, and registers a window listener for
 * future changes. (Note that this won't re-render if the element changes dimensions without a
 * window resize occurring)
 */
export function useWidth(measuredElement: HTMLElement): number {
  const [width, setWidth] = useState(0)
  useLayoutEffect(() => {
    setWidth(measuredElement.clientWidth)
  }, [measuredElement])
  useWindowListener('resize', () => {
    setWidth(measuredElement.clientWidth)
  })

  return width
}

/**
 * A hook that returns the current height of a target element, and registers a window listener for
 * future changes. (Note that this won't re-render if the element changes dimensions without a
 * window resize occurring)
 */
export function useHeight(measuredElement: HTMLElement): number {
  const [height, setHeight] = useState(0)
  useLayoutEffect(() => {
    setHeight(measuredElement.clientHeight)
  }, [measuredElement])
  useWindowListener('resize', () => {
    setHeight(measuredElement.clientHeight)
  })

  return height
}
