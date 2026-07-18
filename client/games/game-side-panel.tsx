// Generic sticky detail panel used by game/replay list pages (e.g. the replay library, and
// future side panels on the games and match-history pages) to show the currently selected entry.
import * as React from 'react'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { MapNoImage } from '../maps/map-image'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyMedium, titleLarge } from '../styles/typography'

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

const GameSidePanelEmptyText = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 160px;

  color: var(--theme-on-surface-variant);
  text-align: center;
`

export const GameSidePanelHeader = styled.div`
  display: flex;
  flex-direction: column;
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

export const GameSidePanelSubline = styled.div`
  ${bodyMedium};

  display: flex;
  align-items: center;
  gap: 4px;

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
  /** True when the adjacent list is day-grouped, so the panel's top aligns with the first row. */
  alignWithFirstRow?: boolean
  className?: string
  children?: React.ReactNode
}

export function GameSidePanel({
  map,
  alignWithFirstRow = false,
  className,
  children,
}: GameSidePanelProps) {
  return (
    <GameSidePanelRoot $alignWithFirstRow={alignWithFirstRow} className={className}>
      {map ? (
        <GameSidePanelMapThumbnail
          key={map.hash}
          mapId={map.id}
          forceAspectRatio={1}
          showInfoLayer={true}
        />
      ) : (
        <GameSidePanelMapPlaceholder>
          <MapNoImage />
        </GameSidePanelMapPlaceholder>
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
