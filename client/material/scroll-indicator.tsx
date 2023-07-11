import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import styled from 'styled-components'
import { background800, colorDividers } from '../styles/colors'

const ScrollObserved = styled.div`
  width: 0px;
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

  background-color: ${props => (props.$show ? colorDividers : 'transparent')};
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
    var(--sb-color-background, ${background800}) 0%,
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
  const observerRef = useRef<IntersectionObserver>()
  const topElemRef = useRef<HTMLDivElement>(null)
  const bottomElemRef = useRef<HTMLDivElement>(null)

  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const startObserving = useCallback(() => {
    if (!observerRef.current) {
      return
    }

    const observer = observerRef.current
    if (topElemRef.current) {
      observer.observe(topElemRef.current)
    }
    if (bottomElemRef.current) {
      observer.observe(bottomElemRef.current)
    }
  }, [])

  const onIntersection = useCallback((entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      switch (entry.target) {
        case topElemRef.current:
          setIsAtTop(entry.isIntersecting)
          break
        case bottomElemRef.current:
          setIsAtBottom(entry.isIntersecting)
          break
      }
    }
  }, [])

  useLayoutEffect(() => {
    observerRef.current = new IntersectionObserver(onIntersection)
    startObserving()

    return () => {
      observerRef.current?.disconnect()
      observerRef.current = undefined
    }
  }, [onIntersection, startObserving])

  useEffect(() => {
    observerRef.current?.disconnect()
    startObserving()
  }, [refreshToken, startObserving])

  const [topNode, bottomNode] = useMemo(() => {
    return [
      <ScrollObserved ref={topElemRef} key='top' />,
      <ScrollObserved ref={bottomElemRef} key='bottom' />,
    ]
  }, [])

  return [isAtTop, isAtBottom, topNode, bottomNode]
}
