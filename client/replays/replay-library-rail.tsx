import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { keyframes } from 'styled-components'
import { ReplayBackfillProgress, ReplayPlaylist } from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { MaterialIcon } from '../icons/material/material-icon'
import { IconButton } from '../material/button'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium, labelMedium, singleLine } from '../styles/typography'
import { LibraryView } from './replay-library-helpers'

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
`

// A plain `div` (not `button`) so playlist rows can host a real, non-nested `<button>` for their
// hover-revealed overflow menu.
const RailItemRoot = styled.div<{ $selected: boolean }>`
  position: relative;
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

  &::before {
    content: '';
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 2px;

    border-radius: 1px;
    background-color: ${props => (props.$selected ? 'var(--theme-primary)' : 'transparent')};
  }

  &:focus-visible {
    outline: 2px solid var(--theme-grey-blue);
    outline-offset: -2px;
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
`

const RailItemCount = styled.div`
  ${labelMedium};
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

const RailItemActions = styled.div<{ $forceVisible: boolean }>`
  flex-shrink: 0;
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

function RailItem({
  icon,
  label,
  count,
  selected,
  onClick,
  actions,
  actionsForceVisible = false,
}: {
  icon: string
  label: string
  count?: number
  selected: boolean
  onClick: () => void
  actions?: React.ReactNode
  actionsForceVisible?: boolean
}) {
  return (
    <RailItemRoot
      $selected={selected}
      role='button'
      tabIndex={0}
      onClick={onClick}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}>
      <RailItemIcon icon={icon} />
      <RailItemLabel title={label}>{label}</RailItemLabel>
      {count !== undefined ? <RailItemCount>{count}</RailItemCount> : null}
      {actions ? (
        <RailItemActions $forceVisible={actionsForceVisible}>{actions}</RailItemActions>
      ) : null}
    </RailItemRoot>
  )
}

function PlaylistRailItem({
  playlist,
  selected,
  onSelect,
}: {
  playlist: ReplayPlaylist
  selected: boolean
  onSelect: () => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'top')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <RailItem
        icon='queue_music'
        label={playlist.name}
        count={playlist.count}
        selected={selected}
        onClick={onSelect}
        actionsForceVisible={menuOpen}
        actions={
          <RailItemMenuButton
            ref={anchor}
            icon={<MaterialIcon icon='more_vert' size={18} />}
            title={t('replays.library.rail.playlistActions', 'Playlist actions')}
            onClick={event => {
              event.stopPropagation()
              openMenu(event)
            }}
          />
        }
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
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

  return (
    <RailRoot>
      <RailSection>
        <RailSectionTitle>{t('replays.library.rail.library', 'Library')}</RailSectionTitle>
        <RailItem
          icon='movie'
          label={t('replays.library.rail.allReplays', 'All replays')}
          count={totalIndexed}
          selected={view.kind === 'all'}
          onClick={() => onSelectView({ kind: 'all' })}
        />
        <RailItem
          icon='bookmark'
          label={t('replays.library.rail.bookmarked', 'Bookmarked')}
          count={bookmarkedCount}
          selected={view.kind === 'bookmarked'}
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
            onSelect={() => onSelectView({ kind: 'playlist', id: p.id })}
          />
        ))}
        <RailItem
          icon='add'
          label={t('replays.library.rail.newPlaylist', 'New playlist')}
          selected={false}
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
