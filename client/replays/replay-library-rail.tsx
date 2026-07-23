import * as React from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { ReplayBackfillProgress, ReplayPlaylist } from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { useBreakpoint } from '../dom/dimension-hooks'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { OriginX, Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium, labelMedium, singleLine } from '../styles/typography'
import { LibraryView } from './replay-library-helpers'

// The width at which the rail collapses to an icon-only strip, keyed to the ancestor
// `replay-library-body` container's inline-size (set up in replay-library.tsx). This mirrors the
// container query below via a ResizeObserver on the rail's own rendered width, rather than
// duplicating the container breakpoint: 72px (collapsed) and 240px (expanded) sit well on either
// side of the 100px threshold.
const RAIL_COLLAPSE_BREAKPOINTS: Array<[minWidth: number, collapsed: boolean]> = [
  [0, true],
  [100, false],
]

const RailRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;

  width: 240px;
  flex-shrink: 0;
  align-self: flex-start;
  position: sticky;
  top: 24px;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  transition: width 125ms ease-out;

  @container replay-library-body (width < 1100px) {
    width: 72px;
  }
`

const RailSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`

const RailSectionTitle = styled.div`
  ${labelMedium};
  ${singleLine};

  height: 28px;
  padding: 0 8px;

  display: flex;
  align-items: center;

  color: var(--theme-on-surface-variant);

  @container replay-library-body (width < 1100px) {
    display: none;
  }
`

// A plain `div` (not `button`) so playlist rows can host a real, non-nested `<button>` for their
// hover-revealed overflow menu.
const RailItemRoot = styled.div<{ $selected: boolean }>`
  width: 100%;
  height: 34px;
  padding: 0 6px 0 14px;

  display: flex;
  align-items: center;
  gap: 8px;

  border-radius: 6px;
  contain: content;
  cursor: pointer;

  background-color: ${props => (props.$selected ? 'var(--theme-container-high)' : 'transparent')};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'var(--theme-container-high)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
  }

  @container replay-library-body (width < 1100px) {
    width: 40px;
    height: 40px;
    padding: 0;
    justify-content: center;
    margin: 0 auto;
  }
`

const RailItemIcon = styled(MaterialIcon).attrs({ size: 18 })`
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const RailItemLabel = styled.div`
  ${bodyMedium};
  ${singleLine};
  flex-grow: 1;
  color: var(--theme-on-surface);

  @container replay-library-body (width < 1100px) {
    display: none;
  }
`

const RailItemCount = styled.div<{ $hasActions: boolean; $hidden: boolean }>`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;

  opacity: ${props => (props.$hidden ? 0 : 1)};
  transition: opacity 0.15s ease;

  ${props =>
    props.$hasActions
      ? css`
          ${RailItemRoot}:hover &,
          ${RailItemRoot}:focus-visible & {
            opacity: 0;
          }
        `
      : css``}
`

// Absolutely positioned over `RailItemEnd` so the action button overlays the count instead of
// pushing it out of place, keeping the count flush at the same right edge on every row.
const RailItemActions = styled.div<{ $forceVisible: boolean }>`
  position: absolute;
  inset: 0;

  display: flex;
  align-items: center;
  justify-content: center;

  opacity: ${props => (props.$forceVisible ? 1 : 0)};
  transition: opacity 0.15s ease;

  ${RailItemRoot}:hover &,
  ${RailItemRoot}:focus-visible & {
    opacity: 1;
  }
`

const RailItemMenuButton = styled(IconButton)`
  width: 28px;
  min-height: 28px;
`

// Anchors the count and (if present) the hover-revealed action button to the same right-aligned
// spot, regardless of whether this row has actions. `min-width` keeps the 28px button from
// overflowing the row when the count itself is narrow (e.g. a single digit).
const RailItemEnd = styled.div`
  position: relative;
  flex-shrink: 0;
  min-width: 28px;
  align-self: stretch;

  display: flex;
  align-items: center;
  justify-content: flex-end;

  // Hides the count and the playlist row's hover-revealed overflow-menu button together — neither
  // fits the icon-only strip, and the menu stays reachable via right-click regardless.
  @container replay-library-body (width < 1100px) {
    display: none;
  }
`

function RailItem({
  icon,
  label,
  count,
  selected,
  onClick,
  onContextMenu,
  actions,
  actionsForceVisible = false,
  collapsed = false,
}: {
  icon: string
  label: string
  count?: number
  selected: boolean
  onClick: () => void
  onContextMenu?: (event: React.MouseEvent) => void
  actions?: React.ReactNode
  actionsForceVisible?: boolean
  /**
   * Whether the rail is currently in its icon-only collapsed state. Shows a tooltip with `label`
   * when true (the label text itself is hidden by the rail's container query at that point); the
   * tooltip stays disabled in expanded mode since the label is already visible there.
   */
  collapsed?: boolean
}) {
  const hasActions = actions !== undefined

  return (
    <Tooltip text={label} position='right' disabled={!collapsed} tabIndex={-1}>
      <RailItemRoot
        $selected={selected}
        role='button'
        tabIndex={0}
        /* The label is visually hidden in the collapsed icon-only strip, so the accessible name
           can't rely on the text content alone. */
        aria-label={label}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}>
        <RailItemIcon icon={icon} />
        <RailItemLabel title={label}>{label}</RailItemLabel>
        {count !== undefined || hasActions ? (
          <RailItemEnd>
            {count !== undefined ? (
              <RailItemCount $hasActions={hasActions} $hidden={hasActions && actionsForceVisible}>
                {count}
              </RailItemCount>
            ) : null}
            {actions ? (
              <RailItemActions $forceVisible={actionsForceVisible}>{actions}</RailItemActions>
            ) : null}
          </RailItemEnd>
        ) : null}
      </RailItemRoot>
    </Tooltip>
  )
}

function PlaylistRailItem({
  playlist,
  selected,
  collapsed,
  onSelect,
}: {
  playlist: ReplayPlaylist
  selected: boolean
  collapsed: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  // Overrides the overflow button's anchor with the cursor position when the menu was opened via
  // right-click instead; cleared again once the button reopens it.
  const [cursorAnchor, setCursorAnchor] = useState<{ x: number; y: number }>()

  const menuAnchorX = cursorAnchor ? cursorAnchor.x : (anchorX ?? 0)
  const menuAnchorY = cursorAnchor ? cursorAnchor.y : (anchorY ?? 0)
  const menuOriginX: OriginX = cursorAnchor ? 'left' : 'right'

  return (
    <>
      <RailItem
        icon='queue_music'
        label={playlist.name}
        count={playlist.count}
        selected={selected}
        collapsed={collapsed}
        onClick={onSelect}
        onContextMenu={event => {
          event.preventDefault()
          setCursorAnchor({ x: event.pageX, y: event.pageY })
          openMenu(event)
        }}
        actionsForceVisible={menuOpen}
        actions={
          <RailItemMenuButton
            ref={anchor}
            icon={<MaterialIcon icon='more_vert' size={18} />}
            title={t('replays.library.rail.playlistActions', 'Playlist actions')}
            onClick={event => {
              event.stopPropagation()
              setCursorAnchor(undefined)
              openMenu(event)
            }}
          />
        }
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={menuAnchorX}
        anchorY={menuAnchorY}
        originX={menuOriginX}
        originY='top'>
        <MenuList dense={true}>
          <MenuItem
            icon={<MaterialIcon icon='edit' />}
            text={t('common.actions.rename', 'Rename')}
            onClick={() => {
              closeMenu()
              dispatch(
                openDialog({
                  type: DialogType.RenamePlaylist,
                  initData: { playlistId: playlist.id, currentName: playlist.name },
                }),
              )
            }}
          />
          <DestructiveMenuItem
            icon={<MaterialIcon icon='delete' />}
            text={t('common.actions.delete', 'Delete')}
            onClick={() => {
              closeMenu()
              dispatch(
                openDialog({
                  type: DialogType.DeletePlaylist,
                  initData: { playlistId: playlist.id, name: playlist.name },
                }),
              )
            }}
          />
        </MenuList>
      </Popover>
    </>
  )
}

const ProgressTrack = styled.div`
  position: relative;
  width: 100%;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background-color: var(--theme-container-highest);
`

const ProgressFill = styled.div<{ $scale: number }>`
  position: absolute;
  inset: 0;
  border-radius: 2px;
  background-color: var(--theme-amber);
  transform: ${props => `scaleX(${props.$scale})`};
  transform-origin: 0% 50%;
  transition: transform 120ms linear;
  will-change: transform;
`

const indeterminateSlide = keyframes`
  0% { transform: translateX(-100%); }
  100% { transform: translateX(350%); }
`

const IndeterminateFill = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  width: 40%;
  border-radius: 2px;
  background-color: var(--theme-amber);
  animation: ${indeterminateSlide} 1.15s ease-in-out infinite;
  will-change: transform;
`

const BackfillBar = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 8px;
`

const BackfillLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;

  @container replay-library-body (width < 1100px) {
    display: none;
  }
`

/**
 * A slim, persistent progress indicator shown in the rail while the index backfills: an
 * indeterminate bar while the folder is being scanned (total unknown), then a determinate bar with a
 * running count as replays are parsed. It rides beneath the library counts so the list area stays
 * clear.
 */
export function BackfillProgressBar({ backfill }: { backfill: ReplayBackfillProgress }) {
  const { t } = useTranslation()

  if (backfill.phase === 'scanning') {
    return (
      <BackfillBar>
        <BackfillLabel>
          {t('replays.library.scanningTitle', 'Scanning your replay folder…')}
        </BackfillLabel>
        <ProgressTrack>
          <IndeterminateFill />
        </ProgressTrack>
      </BackfillBar>
    )
  }

  const { done, total } = backfill
  const scale = total > 0 ? done / total : 0
  return (
    <BackfillBar>
      <BackfillLabel>
        {t('replays.library.indexingCountLine', {
          defaultValue: 'Indexing replays… {{done}}/{{total}}',
          done,
          total,
        })}
      </BackfillLabel>
      <ProgressTrack>
        <ProgressFill $scale={scale} />
      </ProgressTrack>
    </BackfillBar>
  )
}

export interface ReplayLibraryRailProps {
  view: LibraryView
  totalIndexed: number
  bookmarkedCount: number
  /** Backfill progress to surface beneath the library counts, or undefined to hide it. */
  backfill?: ReplayBackfillProgress
  playlists: ReadonlyArray<ReplayPlaylist>
  onSelectView: (view: LibraryView) => void
}

/** The left library rail: All replays/Bookmarked, and the user's playlists. */
export function ReplayLibraryRail({
  view,
  totalIndexed,
  bookmarkedCount,
  backfill,
  playlists,
  onSelectView,
}: ReplayLibraryRailProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  // Observes the rail's own rendered width so JS behavior (tooltips) follows the same collapse
  // point as the CSS container query on `RailRoot`, without hardcoding the page-body breakpoint
  // here too.
  const [railRef, collapsed] = useBreakpoint<HTMLDivElement, boolean>(
    RAIL_COLLAPSE_BREAKPOINTS,
    false,
  )

  return (
    <RailRoot ref={railRef}>
      <RailSection>
        <RailSectionTitle>{t('replays.library.rail.library', 'Library')}</RailSectionTitle>
        <RailItem
          icon='movie'
          label={t('replays.library.rail.allReplays', 'All replays')}
          count={totalIndexed}
          selected={view.kind === 'all'}
          collapsed={collapsed}
          onClick={() => onSelectView({ kind: 'all' })}
        />
        <RailItem
          icon='bookmark'
          label={t('replays.library.rail.bookmarked', 'Bookmarked')}
          count={bookmarkedCount}
          selected={view.kind === 'bookmarked'}
          collapsed={collapsed}
          onClick={() => onSelectView({ kind: 'bookmarked' })}
        />
      </RailSection>

      {backfill ? <BackfillProgressBar backfill={backfill} /> : null}

      <RailSection>
        <RailSectionTitle>{t('replays.library.rail.playlists', 'Playlists')}</RailSectionTitle>
        {playlists.map(p => (
          <PlaylistRailItem
            key={p.id}
            playlist={p}
            selected={view.kind === 'playlist' && view.id === p.id}
            collapsed={collapsed}
            onSelect={() => onSelectView({ kind: 'playlist', id: p.id })}
          />
        ))}
        <RailItem
          icon='add'
          label={t('replays.library.rail.newPlaylist', 'New playlist')}
          selected={false}
          collapsed={collapsed}
          onClick={() => {
            dispatch(
              openDialog({
                type: DialogType.CreatePlaylist,
                initData: {
                  onCreated: id => onSelectView({ kind: 'playlist', id }),
                },
              }),
            )
          }}
        />
      </RailSection>
    </RailRoot>
  )
}
