import * as React from 'react'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'

const ScrollObserved = styled.div`
  width: 1px;
  height: 0px;
`

/**
 * A line that will be drawn if `$show` is `true`. Must be placed inside a `position: relative`
 * ancestor.
 */
export const ScrollDivider = styled.div<{ $show: boolean; $showAt: 'top' | 'bottom' }>`
  position: absolute;
  height: 1px;
  left: 0;
  right: 0;

  ${props => (props.$showAt === 'top' ? 'top: 0;' : 'bottom: 0;')};

  background-color: ${props => (props.$show ? 'var(--theme-outline-variant)' : 'transparent')};
  transition: background-color 150ms linear;
`

/**
 * A scroll divider that will fade the content into the background color if shown. Must be placed
 * inside a `position: relative` ancestor and have the `--sb-color-background` custom CSS property
 * set to the container's background color.
 */
export const GradientScrollDivider = styled.div<{
  $show: boolean
  $showAt: 'top' | 'bottom'
  $heightPx: number
}>`
  position: absolute;
  height: ${props => props.$heightPx}px;
  left: 0;
  right: 0;
  ${props => (props.$showAt === 'top' ? 'top: 0;' : 'bottom: 0;')};

  background: linear-gradient(
    ${props => (props.$showAt === 'top' ? '180deg' : '0deg')},
    var(--sb-color-background, var(--theme-container-low)) 0%,
    transparent 100%
  );
  opacity: ${props => (props.$show ? 1 : 0)};
  pointer-events: none;
  transition: opacity 75ms linear;
  z-index: 10;
`

interface ScrollIndicatorStateProps {
  /**
   * An opaque value that should change to indicate the scroll state needs to be recalculated. For
   * instance, in a UI that shows multiple tabs that all use the same basic content layout, this
   * might be the tab ID.
   */
  refreshToken?: unknown
}

/**
 * Hook that uses an `IntersectionObserver` to track whether we are at the top and/or bottom of the
 * content (which can be used to show/hide dividers as necessary).
 *
 * @returns the current state, as well as elements that should be placed at the top and bottom of
 * the content (they will not be visible or add height).
 */
export function useScrollIndicatorState({ refreshToken }: ScrollIndicatorStateProps = {}): [
  /** Whether the very top of the content is visible. */
  isAtTop: boolean,
  /** Whether the very bottom of the content is visible. */
  isAtBottom: boolean,
  /** An element that should be placed at the top of the content area. */
  topElem: React.ReactNode,
  /** An element that should be placed at the bottom of the content area. */
  bottomElem: React.ReactNode,
] {
  const observerRef = useRef<IntersectionObserver>(undefined)

  const [topElem, setTopElem] = useState<HTMLDivElement | null>(null)
  const [bottomElem, setBottomElem] = useState<HTMLDivElement | null>(null)

  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  useLayoutEffect(() => {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target instanceof HTMLDivElement) {
          if (entry.target.dataset.top) {
            setIsAtTop(entry.isIntersecting)
          } else if (entry.target.dataset.bottom) {
            setIsAtBottom(entry.isIntersecting)
          }
        }
      }
    })
    observerRef.current = observer

    return () => {
      observer.disconnect()
      if (observerRef.current === observer) {
        observerRef.current = undefined
      }
    }
  }, [])

  useEffect(() => {
    const observer = observerRef.current
    if (!observer) {
      return () => {}
    }

    observer.disconnect()

    if (topElem) {
      observer.observe(topElem)
    }
    if (bottomElem) {
      observer.observe(bottomElem)
    }

    return () => {
      observer.disconnect()
    }
  }, [bottomElem, refreshToken, topElem])

  const id = useId()
  const [topNode, bottomNode] = useMemo(() => {
    return [
      <ScrollObserved
        ref={elem => {
          setTopElem(elem)
          if (!elem) {
            setIsAtTop(true)
          }
        }}
        key={id + 'top'}
        data-top
      />,
      <ScrollObserved
        ref={elem => {
          setBottomElem(elem)
          if (!elem) {
            setIsAtBottom(true)
          }
        }}
        key={id + 'bottom'}
        data-bottom
      />,
    ]
  }, [id])

  return [isAtTop, isAtBottom, topNode, bottomNode]
}
