// Generic sticky detail panel used by game/replay list pages (e.g. the replay library, and
// future side panels on the games and match-history pages) to show the currently selected entry.
import * as React from 'react'
import styled, { keyframes } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { MapNoImage } from '../maps/map-image'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, bodySmall, singleLine, titleLarge } from '../styles/typography'
import { GameRelativeTime } from './game-list-entry'

// Mirrors `DayHeader`'s own box (see `client/games/day-header.tsx`): 16px top padding + 20px
// `titleSmall` line-height + 8px bottom padding. Used to align the panel with the first replay
// row instead of the day separator above it, when the list is day-grouped.
const DAY_HEADER_HEIGHT_PX = 44

const GameSidePanelRoot = styled.div<{ $alignWithFirstRow: boolean }>`
  ${containerStyles(ContainerLevel.Low)};

  flex-shrink: 0;
  width: 340px;
  align-self: flex-start;
  position: sticky;
  top: 24px;
  max-height: calc(100vh - 96px);
  padding: 24px;
  margin-top: ${props => (props.$alignWithFirstRow ? `${DAY_HEADER_HEIGHT_PX}px` : '0')};

  display: flex;
  flex-direction: column;
  gap: 20px;

  border-radius: 8px;
  overflow-y: auto;
`

const GameSidePanelMapThumbnail = styled(ReduxMapThumbnail)`
  width: 100%;
  height: auto;
  aspect-ratio: 1;

  border-radius: 8px;
`

const GameSidePanelMapPlaceholder = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1;

  border-radius: 8px;
  contain: content;
`

const mapSkeletonShimmer = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
`

// A quiet placeholder for the hero image while the selected entry's map is still being fetched.
// Shown instead of the "no map" tile so rapidly moving through the list (e.g. holding the down
// arrow) doesn't flash "map preview not available" before each image resolves.
const GameSidePanelMapSkeleton = styled.div`
  position: relative;
  width: 100%;
  aspect-ratio: 1;

  border-radius: 8px;
  background-color: var(--theme-container);
  overflow: hidden;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    transform: translateX(-100%);
    background: linear-gradient(
      90deg,
      transparent,
      rgb(from var(--theme-skeleton) r g b / 0.24),
      transparent
    );
    animation: ${mapSkeletonShimmer} 1.5s ease-in-out infinite;

    @media (prefers-reduced-motion: reduce) {
      animation: none;
    }
  }
`

const GameSidePanelEmptyText = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

const HeaderAndHero = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const HeaderMetaRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

export const GameSidePanelChipsRow = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
`

export const GameSidePanelTitle = styled.div`
  ${titleLarge};
`

/** The panel's meta row's relative-time side, e.g. "18h ago"; hover reveals the absolute time. */
export const GameSidePanelRelativeTime = styled(GameRelativeTime)`
  ${bodySmall};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

export const GameSidePanelSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

export const GameSidePanelActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

export interface GameSidePanelProps {
  /** Map shown as the panel's hero image; a placeholder tile is shown when undefined. */
  map?: ReadonlyDeep<MapInfoJson>
  /**
   * When true and no `map` is resolved yet, shows a loading skeleton instead of the "no preview"
   * placeholder — avoids flashing "not available" while the map is still being fetched.
   */
  isMapLoading?: boolean
  /**
   * A one-line row (chips + relative time) shown above the hero image, grouped tightly with it so
   * the two read as one unit. Omitted entirely (rather than left blank) when there's nothing to
   * show above the hero, e.g. a replay that failed to parse.
   */
  headerMeta?: React.ReactNode
  /** True when the adjacent list is day-grouped, so the panel's top aligns with the first row. */
  alignWithFirstRow?: boolean
  className?: string
  children?: React.ReactNode
}

export function GameSidePanel({
  map,
  isMapLoading = false,
  headerMeta,
  alignWithFirstRow = false,
  className,
  children,
}: GameSidePanelProps) {
  let hero: React.ReactNode
  if (map) {
    hero = (
      <GameSidePanelMapThumbnail
        key={map.hash}
        mapId={map.id}
        forceAspectRatio={1}
        showInfoLayer={true}
      />
    )
  } else if (isMapLoading) {
    hero = <GameSidePanelMapSkeleton />
  } else {
    hero = (
      <GameSidePanelMapPlaceholder>
        <MapNoImage />
      </GameSidePanelMapPlaceholder>
    )
  }

  return (
    <GameSidePanelRoot $alignWithFirstRow={alignWithFirstRow} className={className}>
      {headerMeta ? (
        <HeaderAndHero>
          <HeaderMetaRow>{headerMeta}</HeaderMetaRow>
          {hero}
        </HeaderAndHero>
      ) : (
        hero
      )}

      {children}
    </GameSidePanelRoot>
  )
}

export function GameSidePanelEmpty({
  alignWithFirstRow = false,
  className,
  children,
}: {
  alignWithFirstRow?: boolean
  className?: string
  children?: React.ReactNode
}) {
  return (
    <GameSidePanelRoot $alignWithFirstRow={alignWithFirstRow} className={className}>
      <GameSidePanelEmptyText>{children}</GameSidePanelEmptyText>
    </GameSidePanelRoot>
  )
}
