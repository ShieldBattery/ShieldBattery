import { useRef } from 'react'
import { useStableCallback } from '../state-hooks'

/**
 * Hook that returns a `scrollerRef` for Virtuoso scrollers that fixes stuck scrolling on
 * Chrome 102+.
 *
 * TODO(tec27): Delete this once Chrome is fixed again. To test, attempt scrolling a multi-page list
 * without moving the mouse at all. If scrolling gets stuck after about 1 page of scrolling, the bug
 * is not fixed.
 */
export function useVirtuosoScrollFix(): [scrollerRef: (ref: HTMLElement | Window | null) => void] {
  const ref = useRef<HTMLElement | Window>()
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const onScroll = useStableCallback((event: Event) => {
    const target = (event.currentTarget as HTMLElement).querySelector('[data-viewport-type]')
    if (target instanceof HTMLElement) {
      target.style.pointerEvents = 'none'

      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
      timerRef.current = setTimeout(() => {
        target.style.pointerEvents = ''
        timerRef.current = undefined
      }, 20)
    }
  })

  const setRef = useStableCallback((nextValue: HTMLElement | Window | null) => {
    if (ref.current instanceof HTMLElement) {
      ref.current.removeEventListener('mousewheel', onScroll)
      ref.current.style.pointerEvents = ''
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    ref.current = nextValue ?? undefined
    if (ref.current instanceof HTMLElement) {
      ref.current.addEventListener('mousewheel', onScroll)
    }
  })

  return [setRef]
}
