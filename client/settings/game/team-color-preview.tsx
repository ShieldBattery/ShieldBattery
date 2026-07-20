import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { MaterialIcon } from '../../icons/material/material-icon'
import { buttonReset } from '../../material/button-reset'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../../material/popover'
import { bodySmall, labelSmall, singleLine } from '../../styles/typography'

export type TilesetId =
  | 'jungle'
  | 'badlands'
  | 'desert'
  | 'ice'
  | 'space'
  | 'twilight'
  | 'ashworld'
  | 'installation'

interface TilesetDef {
  id: TilesetId
  label: string
  /** The minimap's base background color. */
  base: string
  /** The color of the large central terrain blob. */
  mid: string
  /** The color of the two smaller terrain highlights. */
  highlight: string
}

/** The tileset backgrounds cycled by the preview panel's tileset selector. */
const TILESETS: ReadonlyArray<TilesetDef> = [
  { id: 'jungle', label: 'Jungle', base: '#081208', mid: '#122514', highlight: '#1e3a22' },
  { id: 'badlands', label: 'Badlands', base: '#1b1310', mid: '#33221c', highlight: '#452e24' },
  { id: 'desert', label: 'Desert', base: '#1a1206', mid: '#33250e', highlight: '#4a3616' },
  { id: 'ice', label: 'Ice', base: '#0c1218', mid: '#22303e', highlight: '#3c5568' },
  { id: 'space', label: 'Space', base: '#05070d', mid: '#141826', highlight: '#232a40' },
  { id: 'twilight', label: 'Twilight', base: '#0d0a14', mid: '#1f1830', highlight: '#33294d' },
  // Installation is omitted: it only appears in the campaign and rare UMS maps.
  { id: 'ashworld', label: 'Ashworld', base: '#120a08', mid: '#291410', highlight: '#3d1e14' },
]

export const DEFAULT_TILESET: TilesetId = 'jungle'

// Percentage (x, y) positions for each of the 8 preview rows' minimap dots.
const TEAM_DOT_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [16, 76],
  [26, 86],
  [12, 62],
  [30, 70],
  [76, 18],
  [86, 28],
  [66, 12],
  [72, 30],
]
const FFA_DOT_POSITIONS: ReadonlyArray<readonly [number, number]> = [
  [14, 14],
  [50, 9],
  [84, 14],
  [87, 50],
  [84, 84],
  [50, 87],
  [14, 84],
  [11, 50],
]

function getMapBackground(tileset: TilesetDef, variant: 'team' | 'ffa'): string {
  const [centerA, centerB] = variant === 'team' ? ['22% 30%', '78% 72%'] : ['30% 65%', '72% 28%']

  return (
    `radial-gradient(150px 90px at ${centerA}, ${tileset.highlight} 0 60%, transparent 61%), ` +
    `radial-gradient(130px 100px at ${centerB}, ${tileset.highlight} 0 55%, transparent 56%), ` +
    `radial-gradient(220px 160px at 50% 50%, ${tileset.mid} 0 70%, transparent 71%), ` +
    `${tileset.base}`
  )
}

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
`

const HeaderLabel = styled.div`
  ${labelSmall};
  flex-grow: 1;
  text-transform: uppercase;
  color: var(--theme-on-surface-variant);
`

const TilesetTrigger = styled.button`
  ${buttonReset};
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 2px;

  color: var(--theme-on-surface-variant);
  cursor: pointer;
  transition: color 100ms linear;

  &:hover,
  &:focus-visible {
    color: var(--color-blue80);
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }
`

const TilesetTriggerLabel = styled.span`
  ${labelSmall};
  letter-spacing: 0.4px;
`

const TilesetMenuList = styled(MenuList)`
  width: 140px;
`

const SelectedTilesetIcon = styled(MaterialIcon)`
  color: var(--theme-amber);
`

function TilesetSelector({
  value,
  onChange,
}: {
  value: TilesetId
  onChange: (id: TilesetId) => void
}) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'right',
    'bottom',
  )
  const [open, openPopover, closePopover] = usePopoverController({ refreshAnchorPos })
  const current = TILESETS.find(ts => ts.id === value) ?? TILESETS[0]

  return (
    <>
      <TilesetTrigger
        ref={anchorRef}
        type='button'
        onClick={event => (open ? closePopover() : openPopover(event))}>
        <TilesetTriggerLabel>{current.label}</TilesetTriggerLabel>
        <MaterialIcon icon='arrow_drop_down' size={16} />
      </TilesetTrigger>
      <Popover
        open={open}
        onDismiss={closePopover}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <TilesetMenuList dense={true}>
          {TILESETS.map(ts => (
            <MenuItem
              key={ts.id}
              text={ts.label}
              dense={true}
              trailingContent={
                ts.id === value ? <SelectedTilesetIcon icon='check' size={14} /> : null
              }
              onClick={() => {
                onChange(ts.id)
                closePopover()
              }}
            />
          ))}
        </TilesetMenuList>
      </Popover>
    </>
  )
}

const Minimap = styled.div<{ $background: string }>`
  position: relative;
  width: 100%;
  height: 180px;
  margin-bottom: 12px;

  border: 1px solid rgb(255 255 255 / 0.1);
  background: ${props => props.$background};
`

const Dot = styled.div<{ $color: string; $x: number; $y: number }>`
  position: absolute;
  left: ${props => props.$x}%;
  top: ${props => props.$y}%;
  width: 9px;
  height: 9px;
  background-color: ${props => props.$color};
  outline: 1px solid rgb(0 0 0 / 0.55);
`

const Roster = styled.div`
  display: flex;
  gap: 16px;
`

const RosterColumn = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
`

const RosterRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const RosterSwatch = styled.div<{ $color: string }>`
  width: 10px;
  height: 10px;
  flex-shrink: 0;
  background-color: ${props => props.$color};
  box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.5);
`

const RosterName = styled.div<{ $isSelf: boolean }>`
  ${bodySmall};
  ${singleLine};
  color: ${props => (props.$isSelf ? 'var(--color-grey99)' : 'var(--color-grey-blue80)')};
`

export interface PreviewRow {
  color: string
  name: string
  isSelf: boolean
}

export interface TeamColorPreviewProps {
  /** Which mock scenario this preview illustrates (changes the header text and dot layout). */
  variant: 'team' | 'ffa'
  /** Exactly 8 rows, in minimap-dot order; the first 4 render in the left roster column. */
  rows: ReadonlyArray<PreviewRow>
  tileset: TilesetId
  onTilesetChange: (id: TilesetId) => void
  className?: string
}

/**
 * A mock minimap + roster preview of the currently active color assignment, shared by the team
 * and individual-colors cards (with different mock rosters/dot layouts per `variant`).
 */
export function TeamColorPreview({
  variant,
  rows,
  tileset,
  onTilesetChange,
  className,
}: TeamColorPreviewProps) {
  const { t } = useTranslation()
  const tilesetDef = TILESETS.find(ts => ts.id === tileset) ?? TILESETS[0]
  const dotPositions = variant === 'team' ? TEAM_DOT_POSITIONS : FFA_DOT_POSITIONS
  const headerLabel =
    variant === 'team'
      ? t('settings.game.gameplay.teamColors.previewHeaderTeam', 'Preview — 4v4')
      : t('settings.game.gameplay.teamColors.previewHeaderFfa', 'Preview — 8 players, no teams')

  return (
    <div className={className}>
      <Header>
        <HeaderLabel>{headerLabel}</HeaderLabel>
        <TilesetSelector value={tileset} onChange={onTilesetChange} />
      </Header>
      <Minimap $background={getMapBackground(tilesetDef, variant)}>
        {rows.map((row, index) => {
          const [x, y] = dotPositions[index]
          return <Dot key={index} $color={row.color} $x={x} $y={y} />
        })}
      </Minimap>
      <Roster>
        <RosterColumn>
          {rows.slice(0, 4).map((row, index) => (
            <RosterRow key={index}>
              <RosterSwatch $color={row.color} />
              <RosterName $isSelf={row.isSelf}>{row.name}</RosterName>
            </RosterRow>
          ))}
        </RosterColumn>
        <RosterColumn>
          {rows.slice(4).map((row, index) => (
            <RosterRow key={index}>
              <RosterSwatch $color={row.color} />
              <RosterName $isSelf={row.isSelf}>{row.name}</RosterName>
            </RosterRow>
          ))}
        </RosterColumn>
      </Roster>
    </div>
  )
}
