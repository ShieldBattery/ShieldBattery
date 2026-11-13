import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { RoomChip } from '../lobbies/room/room-parts'
import { IconButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Tooltip } from '../material/tooltip'
import { bodySmall, labelSmall, singleLine, titleSmall } from '../styles/typography'

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

/**
 * A map on one compact line. Its hover and focus states cover all of it, controls included: its
 * link stretches over the whole row (see {@link MapRowLink}), and anything interactive beside the
 * link has to sit above that (`position: relative; z-index: 1`).
 */
export const MapRow = styled.li`
  position: relative;
  min-height: 64px;
  padding: 8px 12px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;
  background-color: var(--theme-container-low);

  &:hover {
    background-color: var(--theme-container);
  }

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
  }
`

export const MapRowLink = styled(LinkButton)`
  && {
    position: static;
  }

  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 16px;

  &:focus-visible {
    outline: none;
  }

  /* Makes the whole row the link's target, beneath the row's controls */
  &::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: 6px;
  }
`

export const MapRowThumbnail = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  overflow: hidden;
  border-radius: 4px;
`

export const MapRowText = styled.div`
  flex: 1 1 auto;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

export const MapRowNameLine = styled.div`
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 8px;
`

export const MapRowName = styled.div`
  ${titleSmall};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

export const MapRowMeta = styled.div`
  ${bodySmall};
  ${singleLine};
  color: var(--color-grey-blue80);
`

/**
 * Outside the row's link, so this margin plus the row's gap make the same space the link leaves
 * between its own parts.
 */
const MapRowGames = styled.div`
  ${labelSmall};
  flex-shrink: 0;
  margin-inline-start: 8px;
  color: var(--color-grey-blue70);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`

/** How many games were played on a row's map, or that it hasn't been played. */
export function MapRowGamesCount({ gamesTotal }: { gamesTotal: number | undefined }) {
  const { t } = useTranslation()
  const numbers = useFormat(compactNumber)
  return (
    <MapRowGames>
      {gamesTotal !== undefined
        ? t('maps.catalog.totalGames', {
            defaultValue: '{{formattedCount}} games',
            defaultValue_one: '{{formattedCount}} game',
            count: gamesTotal,
            formattedCount: numbers.format(gamesTotal),
          })
        : t('maps.catalog.notPlayed', 'Not played yet')}
    </MapRowGames>
  )
}

export const MapRowChip = styled(RoomChip)`
  flex-shrink: 0;
  padding-block: 2px;
`

/**
 * Keeps the chip it wraps from shrinking in the row's tight name line, and above the link that
 * covers the row, so hovering it shows the tooltip.
 */
export const MapRowChipTooltip = styled(Tooltip)`
  position: relative;
  z-index: 1;
  flex-shrink: 0;
`

/**
 * A row's buttons, above the link that covers it. It's `$slots` buttons wide whether or not they
 * all show, so the name cuts off at the same place either way. They show while the row is hovered
 * or holds focus (so tabbing to one shows them), and always where nothing can hover. Hidden ones
 * stay in the layout and in the tab order, so showing them shifts nothing.
 */
export const MapRowControls = styled.div<{ $slots: number }>`
  position: relative;
  z-index: 1;
  width: ${props => props.$slots * 32}px;
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;

  opacity: 0;
  pointer-events: none;
  transition: opacity 100ms linear;

  ${MapRow}:hover &,
  ${MapRow}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }

  @media (hover: none) {
    opacity: 1;
    pointer-events: auto;
  }
`

export const MapRowControlButton = styled(IconButton)`
  width: 32px;
  min-height: 32px;
`
