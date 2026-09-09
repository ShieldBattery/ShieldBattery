import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import InfiniteList, { InfiniteListProps } from './infinite-scroll-list'

/** Matches the minimum spacing between two loads of the same edge in the list implementation. */
const MIN_LOAD_INTERVAL_MS = 1000

/**
 * An observer that reports its target as intersecting the moment it starts being observed, which is
 * what the real one does for an element that's already in view.
 */
class ImmediateIntersectionObserver {
  constructor(private callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }

  unobserve() {}

  disconnect() {}

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }
}

describe('client/lists/infinite-scroll-list', () => {
  let currentTime = 0
  let savedIntersectionObserver: unknown

  beforeEach(() => {
    currentTime = 0
    vi.useFakeTimers()
    vi.spyOn(performance, 'now').mockImplementation(() => currentTime)

    savedIntersectionObserver = (globalThis as any).IntersectionObserver
    ;(globalThis as any).IntersectionObserver = ImmediateIntersectionObserver
  })

  afterEach(() => {
    ;(globalThis as any).IntersectionObserver = savedIntersectionObserver
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  const advanceTime = (millis: number) => {
    currentTime += millis
    vi.advanceTimersByTime(millis)
  }

  const doRender = (props: Partial<InfiniteListProps>) => {
    const baseProps: InfiniteListProps = {
      children: <div>list contents</div>,
      prevLoadingEnabled: true,
      hasPrevData: true,
      isLoadingPrev: false,
      ...props,
    }
    const result = render(<InfiniteList {...baseProps} />)

    return {
      unmount: result.unmount,
      rerender: (nextProps: Partial<InfiniteListProps>) =>
        result.rerender(<InfiniteList {...baseProps} {...nextProps} />),
    }
  }

  test('a page that leaves the sentinel in view is not re-requested before the interval', () => {
    const onLoadPrevData = vi.fn()
    const { rerender } = doRender({ onLoadPrevData })
    expect(onLoadPrevData).toHaveBeenCalledTimes(1)

    // A page that failed leaves the list exactly as it was, so the sentinel is still in view when
    // the observer restarts for the cleared loading flag
    rerender({ onLoadPrevData, isLoadingPrev: true })
    rerender({ onLoadPrevData, isLoadingPrev: false })
    expect(onLoadPrevData).toHaveBeenCalledTimes(1)

    advanceTime(MIN_LOAD_INTERVAL_MS)
    expect(onLoadPrevData).toHaveBeenCalledTimes(2)

    rerender({ onLoadPrevData, isLoadingPrev: true })
    rerender({ onLoadPrevData, isLoadingPrev: false })
    rerender({ onLoadPrevData, isLoadingPrev: true })
    rerender({ onLoadPrevData, isLoadingPrev: false })
    expect(onLoadPrevData).toHaveBeenCalledTimes(2)
  })

  test('a refresh token change loads immediately', () => {
    const onLoadPrevData = vi.fn()
    const { rerender } = doRender({ onLoadPrevData, refreshToken: 'first' })
    expect(onLoadPrevData).toHaveBeenCalledTimes(1)

    rerender({ onLoadPrevData, refreshToken: 'second' })
    expect(onLoadPrevData).toHaveBeenCalledTimes(2)
  })

  test('a deferred load is dropped when the list is torn down first', () => {
    const onLoadPrevData = vi.fn()
    const { rerender, unmount } = doRender({ onLoadPrevData })
    expect(onLoadPrevData).toHaveBeenCalledTimes(1)

    rerender({ onLoadPrevData, isLoadingPrev: true })
    rerender({ onLoadPrevData, isLoadingPrev: false })
    unmount()

    advanceTime(MIN_LOAD_INTERVAL_MS * 5)
    expect(onLoadPrevData).toHaveBeenCalledTimes(1)
  })
})
