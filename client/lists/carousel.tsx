import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import WindowListener from '../dom/window-listener'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton, Label } from '../material/button'
import { standardEasing } from '../material/curve-constants'
import InfiniteScrollList, { InfiniteListProps } from './infinite-scroll-list'

const BUTTON_WIDTH = 64
const LOADER_WIDTH = 98
const SCROLL_LEEWAY = 128

const CarouselContainer = styled.div`
  width: 100%;
  display: flex;
  align-items: center;
`

const CarouselContentMask = styled.div<{ $showLeft: boolean; $showRight: boolean }>`
  display: flex;
  flex-grow: 1;
  overflow: hidden;

  ${props => {
    const leftGradient = 'transparent 0%, #000 16%'
    const rightGradient = '#000 84%, transparent 100%'
    const gradients = []

    if (props.$showLeft) {
      gradients.push(leftGradient)
    }
    if (props.$showRight) {
      gradients.push(rightGradient)
    }

    return gradients.length > 0
      ? `-webkit-mask-image: linear-gradient(90deg, ${gradients.join(', ')})`
      : ''
  }};
`

const CarouselContent = styled.div`
  display: flex;
  flex-shrink: 0;
  transition: transform 250ms ${standardEasing};
`

const CarouselButton = styled(IconButton)`
  flex-shrink: 0;
  margin: 0 8px;

  ${Label} {
    color: var(--theme-on-surface-variant);
  }
`

export type CarouselInfiniteListProps = Omit<
  InfiniteListProps,
  | 'prevLoadingEnabled'
  | 'isLoadingPrev'
  | 'hasPrevData'
  | 'onLoadPrevData'
  | 'nextLoadingEnabled'
  | 'children'
>

interface CarouselProps {
  children: React.ReactNode
  infiniteListProps?: CarouselInfiniteListProps
  className?: string
}

/**
 * A component which utilizes InfiniteScrollList to display items in a horizontal list with built-in
 * scrolling. It only supports dynamically adding items at the end of the list.
 */
export function Carousel({ children, infiniteListProps = {}, className }: CarouselProps) {
  const { t } = useTranslation()

  const [translateWidth, setTranslateWidth] = useState(0)
  const [carouselWidth, setCarouselWidth] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [stepWidth, setStepWidth] = useState(0)
  const [hasPrevItems, setHasPrevItems] = useState(false)
  const [hasNextItems, setHasNextItems] = useState(false)

  const carouselRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const animationIdRef = useRef<number | null>(null)

  const calcCarouselWidth = useCallback(() => {
    if (!carouselRef.current || !contentRef.current) {
      return
    }

    // This is the width of currently visible items
    let carouselWidth = carouselRef.current.getBoundingClientRect().width
    // This is the width of all items in total
    const contentWidth = contentRef.current.getBoundingClientRect().width

    const hasPrevItems = translateWidth < 0
    const adjustment = hasPrevItems ? BUTTON_WIDTH : 0
    const hasNextItems = contentWidth - carouselWidth + adjustment > Math.abs(translateWidth)

    if (hasPrevItems && hasNextItems) {
      carouselWidth = carouselWidth - BUTTON_WIDTH * 2 // both prev and next buttons are visible
    } else if (hasPrevItems || hasNextItems) {
      carouselWidth = carouselWidth - BUTTON_WIDTH // only one of the buttons is visible
    }

    // Scroll 60% of the currently visible items
    const stepWidth = carouselWidth * 0.6

    setCarouselWidth(carouselWidth)
    setContentWidth(contentWidth)
    setStepWidth(stepWidth)
    setHasPrevItems(hasPrevItems)
    setHasNextItems(hasNextItems)
  }, [translateWidth])

  useEffect(() => {
    calcCarouselWidth()
    // Need to re-calculate carousel width when children changes in case they were dynamically added
  }, [calcCarouselWidth, children])

  useEffect(() => {
    return () => {
      if (animationIdRef.current !== null) {
        window.cancelAnimationFrame(animationIdRef.current)
      }
    }
  }, [])

  const animatePosition = (delta: number) => {
    setTranslateWidth(translateWidth => translateWidth + delta)
  }

  const contentStyle = { transform: `translateX(${translateWidth}px)` }
  const showPrevButton = hasPrevItems
  const showNextButton = hasNextItems && !infiniteListProps.isLoadingNext

  return (
    <CarouselContainer ref={carouselRef}>
      <WindowListener event='resize' listener={calcCarouselWidth} />
      {showPrevButton ? (
        <CarouselButton
          icon={<MaterialIcon icon='chevron_left' />}
          title={t('common.actions.previous', 'Previous')}
          onClick={() => {
            const delta =
              translateWidth + stepWidth + SCROLL_LEEWAY > 0 ? Math.abs(translateWidth) : stepWidth

            animationIdRef.current = window.requestAnimationFrame(() => animatePosition(delta))
          }}
        />
      ) : null}
      <CarouselContentMask $showLeft={showPrevButton} $showRight={showNextButton}>
        <CarouselContent ref={contentRef} style={contentStyle} className={className}>
          <InfiniteScrollList nextLoadingEnabled={true} {...infiniteListProps}>
            {children}
          </InfiniteScrollList>
        </CarouselContent>
      </CarouselContentMask>
      {showNextButton ? (
        <CarouselButton
          icon={<MaterialIcon icon='chevron_right' />}
          title={t('common.actions.next', 'Next')}
          onClick={() => {
            // When we reach the end of the list, we need to adjust the translate width a bit,
            // depending on whether we have more items to load (in which case the loader will be
            // shown), or if we've reached the last page, then nothing will be shown.
            let adjustment = 0
            if (infiniteListProps.hasNextData && !infiniteListProps.isLoadingNext) {
              adjustment = BUTTON_WIDTH - LOADER_WIDTH
            } else if (hasPrevItems && hasNextItems) {
              adjustment = BUTTON_WIDTH
            }
            const delta =
              Math.abs(translateWidth) + stepWidth + carouselWidth + SCROLL_LEEWAY > contentWidth
                ? contentWidth - Math.abs(translateWidth) - carouselWidth - adjustment
                : stepWidth

            animationIdRef.current = window.requestAnimationFrame(() => animatePosition(-delta))
          }}
        />
      ) : null}
    </CarouselContainer>
  )
}
