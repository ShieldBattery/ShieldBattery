import { useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../icons/material/material-icon'
import { TextButton } from '../material/button'
import { bodyMedium, singleLine, titleLarge } from '../styles/typography'

const ShelfRoot = styled.section`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const ShelfHeader = styled.div`
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 12px;
`

const ShelfTitle = styled.h2<{ $live: boolean }>`
  ${titleLarge};
  ${singleLine};
  margin: 0;
  display: flex;
  align-items: center;
  gap: 10px;

  &::before {
    content: '';
    display: ${props => (props.$live ? 'block' : 'none')};
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--theme-live);
  }
`

const ShelfSubtitle = styled.div`
  ${bodyMedium};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface-variant);
`

const SeeAllButton = styled(TextButton)`
  margin-left: auto;
  flex-shrink: 0;
`

const ScrollerWrap = styled.div`
  position: relative;
`

const Scroller = styled.div`
  display: flex;
  gap: 16px;
  /* Room for a selected card's outline, which would otherwise be clipped. */
  padding: 2px;
  margin: -2px;
  overflow-x: auto;
  overflow-y: hidden;
  overscroll-behavior-x: contain;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }
`

const ScrollArrow = styled.button<{ $side: 'start' | 'end' }>`
  position: absolute;
  top: 0;
  bottom: 0;
  ${props => (props.$side === 'start' ? 'left: 0;' : 'right: 0;')};
  z-index: 2;
  width: 48px;
  padding: 0;

  display: grid;
  place-items: center;

  border: none;
  color: var(--theme-on-surface);
  background: linear-gradient(
    ${props => (props.$side === 'start' ? '90deg' : '270deg')},
    rgb(from var(--theme-surface) r g b / 0.94),
    transparent
  );
  cursor: pointer;
  opacity: 0;
  transition: opacity 120ms linear;

  ${ScrollerWrap}:hover &, &:focus-visible {
    opacity: 1;
  }

  @media (hover: none) {
    display: none;
  }
`

export interface GameShelfProps {
  title: string
  subtitle?: string
  /** Marks the shelf as holding games in progress. */
  live?: boolean
  /** When set, a "See all" button opens the full list of this shelf's games. */
  onSeeAll?: () => void
  children: React.ReactNode
}

/**
 * A titled row of cards that scrolls sideways. Its scroll arrows sit over the first and last cards,
 * so each one only shows while there is more to scroll to on its side.
 */
export function GameShelf({ title, subtitle, live = false, onSeeAll, children }: GameShelfProps) {
  const { t } = useTranslation()
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canScroll, setCanScroll] = useState({ start: false, end: false })

  const updateArrows = () => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return
    }
    const start = scroller.scrollLeft > 4
    const end = scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4
    setCanScroll(prev => (prev.start === start && prev.end === end ? prev : { start, end }))
  }

  // The cards can change on any render, so the arrows are rechecked after each one (a no-op when
  // nothing changed); resizes are caught by the observer.
  useLayoutEffect(() => {
    updateArrows()
  })
  useLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) {
      return undefined
    }
    const observer = new ResizeObserver(() => updateArrows())
    observer.observe(scroller)
    return () => observer.disconnect()
  }, [])

  const scrollBy = (direction: 1 | -1) => {
    const scroller = scrollerRef.current
    if (scroller) {
      scroller.scrollBy({ left: direction * scroller.clientWidth * 0.85, behavior: 'smooth' })
    }
  }

  return (
    <ShelfRoot>
      <ShelfHeader>
        <ShelfTitle $live={live}>{title}</ShelfTitle>
        {subtitle ? <ShelfSubtitle>{subtitle}</ShelfSubtitle> : null}
        {onSeeAll ? (
          <SeeAllButton
            label={t('games.browse.seeAll', 'See all')}
            iconEnd='chevron_right'
            onClick={onSeeAll}
          />
        ) : null}
      </ShelfHeader>
      <ScrollerWrap>
        {canScroll.start ? (
          <ScrollArrow
            $side='start'
            type='button'
            aria-label={t('games.browse.scrollBack', 'Scroll back')}
            onClick={() => scrollBy(-1)}>
            <MaterialIcon icon='chevron_left' size={32} />
          </ScrollArrow>
        ) : null}
        <Scroller ref={scrollerRef} onScroll={updateArrows}>
          {children}
        </Scroller>
        {canScroll.end ? (
          <ScrollArrow
            $side='end'
            type='button'
            aria-label={t('games.browse.scrollForward', 'Scroll forward')}
            onClick={() => scrollBy(1)}>
            <MaterialIcon icon='chevron_right' size={32} />
          </ScrollArrow>
        ) : null}
      </ScrollerWrap>
    </ShelfRoot>
  )
}
