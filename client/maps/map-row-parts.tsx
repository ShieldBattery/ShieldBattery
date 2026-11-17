import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { numberFormat, useFormat } from '../i18n/locale-formats'
import { RoomChip } from '../lobbies/room/room-parts'
import { IconButton } from '../material/button'
import { LinkButton } from '../material/link-button'
import { Tooltip } from '../material/tooltip'
import { bodySmall, labelSmall, singleLine, titleSmall } from '../styles/typography'

const compactNumber = numberFormat({ notation: 'compact', maximumFractionDigits: 1 })

/**
 * A part of a map row beside its link, which a list of rows lines up in a column of its own (see
 * {@link MapRowList}).
 */
export type MapRowColumn = 'recommended' | 'file' | 'games' | 'count' | 'controls' | 'star'

/**
 * The column tracks of a list of map rows: the link's, taking whatever space the others leave, then
 * one for each of `columns` in order, as wide as its widest part. Each track is between the grid
 * lines `<name>-start` and `<name>-end`, so `grid-column: <name>` places a part in it.
 */
export function mapRowTracks(columns: ReadonlyArray<MapRowColumn>): string {
  const names = ['link', ...columns]
  const tracks = names.map((name, i) => {
    const lines = i > 0 ? `${names[i - 1]}-end ${name}-start` : `${name}-start`
    return `[${lines}] ${i > 0 ? 'auto' : 'minmax(0, 1fr)'}`
  })
  return `${tracks.join(' ')} [${names[names.length - 1]}-end]`
}

/**
 * A list of map rows that lines their parts up in columns: each part beside a row's link is in its
 * own column (`$columns`, in order after the link's) on every row, so a row without one of them
 * leaves that column empty instead of moving the parts after it. A column that no row has a part in
 * takes no space, which is why the parts space themselves apart with margins rather than gaps.
 */
export const MapRowList = styled.ol<{ $columns: ReadonlyArray<MapRowColumn> }>`
  margin: 0;
  padding: 0;
  list-style: none;

  display: grid;
  grid-template-columns: ${props => mapRowTracks(props.$columns)};
  gap: 6px 0;
`

/**
 * Lists of map rows one after another (such as one per page loaded) whose columns line up across
 * all of them, as in a {@link MapRowList}. Each list in it is a {@link MapRowSubList}, and anything
 * else in it spans all of the columns.
 */
export const MapRowListGroup = styled.div<{ $columns: ReadonlyArray<MapRowColumn> }>`
  display: grid;
  grid-template-columns: ${props => mapRowTracks(props.$columns)};
  gap: 6px 0;

  & > * {
    grid-column: 1 / -1;
  }
`

/** A list of map rows in a {@link MapRowListGroup}, which lines its rows up in the group's columns. */
export const MapRowSubList = styled.ol`
  grid-column: 1 / -1;
  margin: 0;
  padding: 0;
  list-style: none;

  display: grid;
  grid-template-columns: subgrid;
  row-gap: 6px;
`

/**
 * A map on one compact line, in a {@link MapRowList} or a {@link MapRowSubList} whose columns it
 * lays its parts out in. Its hover and focus states cover all of it, controls included: its link
 * stretches over the whole row (see {@link MapRowLink}), and anything interactive beside the link
 * has to sit above that (`position: relative; z-index: 1`, as {@link MapRowCell} does).
 */
export const MapRow = styled.li`
  position: relative;
  grid-column: 1 / -1;
  min-height: 64px;
  padding: 8px 12px;

  display: grid;
  grid-template-columns: subgrid;
  align-items: center;

  border-radius: 6px;
  background-color: var(--theme-container-low);

  &:hover {
    background-color: var(--theme-container);
  }

  &:has(a:focus-visible) {
    outline: 2px solid var(--theme-primary);
  }
`

/** Fills the link's column with the row's image and text. */
const linkColumn = css`
  grid-column: link;
  min-width: 0;

  display: flex;
  align-items: center;
  gap: 16px;
`

export const MapRowLink = styled(LinkButton)`
  && {
    position: static;
  }

  ${linkColumn};

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

/** The image and text of a row that has nothing to link to, in the link's place. */
export const MapRowPlaceholder = styled.div`
  ${linkColumn};
`

/**
 * A part of a row beside its link, in the column `$column`, above the link that covers the row so
 * it can be used.
 */
export const MapRowCell = styled.div<{ $column: MapRowColumn }>`
  position: relative;
  z-index: 1;
  grid-column: ${props => props.$column};
  margin-inline-start: 8px;

  display: flex;
  align-items: center;
  gap: 4px;
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
 * Set as far from the parts before it as the link sets its own parts apart, and aligned to the end
 * of its column so the counts of every row end in the same place.
 */
const MapRowGames = styled.div`
  ${labelSmall};
  grid-column: games;
  margin-inline-start: 16px;
  color: var(--color-grey-blue70);
  font-variant-numeric: tabular-nums;
  text-align: end;
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
  grid-column: controls;
  width: ${props => props.$slots * 32}px;
  margin-inline-start: 8px;

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
