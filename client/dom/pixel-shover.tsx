import { useLayoutEffect, useState } from 'react'
import { useWindowListener } from './window-listener'

/**
 * A hook that will measure a specific element on a resize and return how many pixels centered items
 * in it need to be "shoved" to end up on a whole pixel.
 *
 * This is mainly useful for things that are centered in their parents, especially via
 * `margin: auto` or flexbox. In such cases, the browser will position their left edge on a half
 * pixel, which can make everything inside of them blurry.
 *
 * @param measuredElement which element to measure when the window is resized. Defaults to the
 * document body
 *
 * @returns a tuple of [x shove, y shove]
 */
export function usePixelShover(measuredElement: HTMLElement = document.body): [number, number] {
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  useLayoutEffect(() => {
    setX(measuredElement.clientWidth % 2)
    setY(measuredElement.clientHeight % 2)
  }, [measuredElement])
  useWindowListener('resize', () => {
    setX(measuredElement.clientWidth % 2)
    setY(measuredElement.clientHeight % 2)
  })

  return [x, y]
}
