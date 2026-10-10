import { TFunction } from 'i18next'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReplayLibraryEntry, ReplayPlaylist } from '../../common/replays-library'
import { GameSidePanelRoot, GameSidePanelTitle } from '../games/game-side-panel'
import { MaterialIcon } from '../icons/material/material-icon'
import { OutlinedButton } from '../material/button'
import { Divider } from '../material/menu/divider'
import { DestructiveMenuItem, MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppDispatch } from '../redux-hooks'
import { getAddToPlaylistMenuItems } from './replay-inspector'

/**
 * Which bookmark action a multi-selection offers: `true` to bookmark the selected rows that aren't
 * yet, `false` to remove the bookmark from all of them (only when every one is bookmarked), or
 * `undefined` when nothing selected can be bookmarked (unreadable replays can't be).
 */
export function getBulkBookmarkAction(
  entries: ReadonlyArray<ReplayLibraryEntry>,
): boolean | undefined {
  const bookmarkable = entries.filter(e => !e.parseError)
  if (bookmarkable.length === 0) {
    return undefined
  }
  return !bookmarkable.every(e => e.bookmarkedAt !== undefined)
}

function getBookmarkText(bookmark: boolean, t: TFunction) {
  return bookmark
    ? t('replays.library.bookmark', 'Bookmark')
    : t('replays.library.removeBookmark', 'Remove bookmark')
}

/**
 * Builds the row context menu's items for a multi-selection: only the actions that make sense on
 * several replays at once (no Watch, View game page, Show in Explorer or reordering).
 *
 * Returns a flat array of keyed `MenuItem` elements so each one stays a direct child of
 * `MenuList` (see `getReplayActionMenuItems`).
 */
export function getBulkReplayActionMenuItems({
  entries,
  inPlaylistView,
  closeMenu,
  onOpenAddToPlaylist,
  onRemoveFromPlaylist,
  onSetBookmarked,
  onMoveToRecycleBin,
  t,
}: {
  entries: ReadonlyArray<ReplayLibraryEntry>
  inPlaylistView: boolean
  closeMenu: () => void
  onOpenAddToPlaylist: (event: React.MouseEvent | KeyboardEvent) => void
  onRemoveFromPlaylist: () => void
  onSetBookmarked: (bookmarked: boolean) => void
  onMoveToRecycleBin: () => void
  t: TFunction
}): React.ReactNode[] {
  const items: React.ReactNode[] = [
    <MenuItem
      key='add-to-playlist'
      icon={<MaterialIcon icon='playlist_add' />}
      text={t('replays.library.addToPlaylist', 'Add to playlist…')}
      onClick={event => {
        closeMenu()
        onOpenAddToPlaylist(event)
      }}
    />,
  ]

  if (inPlaylistView) {
    items.push(
      <MenuItem
        key='remove-from-playlist'
        icon={<MaterialIcon icon='playlist_remove' />}
        text={t('replays.library.removeFromPlaylist', 'Remove from playlist')}
        onClick={() => {
          closeMenu()
          onRemoveFromPlaylist()
        }}
      />,
    )
  }

  const bookmark = getBulkBookmarkAction(entries)
  if (bookmark !== undefined) {
    items.push(
      <MenuItem
        key='bookmark'
        icon={<MaterialIcon icon='bookmark' filled={!bookmark} />}
        text={getBookmarkText(bookmark, t)}
        onClick={() => {
          closeMenu()
          onSetBookmarked(bookmark)
        }}
      />,
    )
  }

  items.push(
    <Divider key='move-to-recycle-bin-divider' $dense={true} />,
    <DestructiveMenuItem
      key='move-to-recycle-bin'
      icon={<MaterialIcon icon='delete' />}
      text={t('replays.library.moveToRecycleBin', 'Move to Recycle Bin')}
      onClick={() => {
        closeMenu()
        onMoveToRecycleBin()
      }}
    />,
  )

  return items
}

const SummaryActions = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
`

const DestructiveOutlinedButton = styled(OutlinedButton)`
  color: var(--theme-negative);
`

export interface ReplaySelectionSummaryProps {
  entries: ReadonlyArray<ReplayLibraryEntry>
  /** True when the list is day-grouped, so the panel's top should align with the first row. */
  alignWithFirstRow: boolean
  playlists: ReadonlyArray<ReplayPlaylist>
  /** True when the library is currently scoped to a single playlist. */
  inPlaylistView: boolean
  onAddToPlaylist: (playlistId: number, playlistName: string) => void
  onRemoveFromPlaylist: () => void
  onSetBookmarked: (bookmarked: boolean) => void
  onMoveToRecycleBin: () => void
}

/**
 * Takes the replay inspector's place while more than one replay is selected: the selection's size
 * plus the actions that apply to all of it.
 */
export function ReplaySelectionSummary({
  entries,
  alignWithFirstRow,
  playlists,
  inPlaylistView,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onSetBookmarked,
  onMoveToRecycleBin,
}: ReplaySelectionSummaryProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition<HTMLButtonElement>(
    'left',
    'bottom',
  )
  const [playlistMenuOpen, openPlaylistMenu, closePlaylistMenu] = usePopoverController({
    refreshAnchorPos,
  })

  const bookmark = getBulkBookmarkAction(entries)

  return (
    <GameSidePanelRoot $alignWithFirstRow={alignWithFirstRow}>
      <GameSidePanelTitle>
        {t('replays.library.selection.count', {
          defaultValue_one: '{{count}} replay selected',
          defaultValue_other: '{{count}} replays selected',
          count: entries.length,
        })}
      </GameSidePanelTitle>

      <SummaryActions>
        <OutlinedButton
          ref={anchor}
          label={t('replays.library.addToPlaylist', 'Add to playlist…')}
          iconStart='playlist_add'
          onClick={openPlaylistMenu}
        />
        {inPlaylistView ? (
          <OutlinedButton
            label={t('replays.library.removeFromPlaylist', 'Remove from playlist')}
            iconStart='playlist_remove'
            onClick={onRemoveFromPlaylist}
          />
        ) : null}
        {bookmark !== undefined ? (
          <OutlinedButton
            label={getBookmarkText(bookmark, t)}
            iconStart={<MaterialIcon icon='bookmark' size={20} filled={!bookmark} />}
            onClick={() => onSetBookmarked(bookmark)}
          />
        ) : null}
        <DestructiveOutlinedButton
          label={t('replays.library.moveToRecycleBin', 'Move to Recycle Bin')}
          iconStart='delete'
          onClick={onMoveToRecycleBin}
        />
      </SummaryActions>

      <Popover
        open={playlistMenuOpen}
        onDismiss={closePlaylistMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense={true}>
          {getAddToPlaylistMenuItems({
            playlists,
            closeMenu: closePlaylistMenu,
            onAddToPlaylist,
            t,
            dispatch,
          })}
        </MenuList>
      </Popover>
    </GameSidePanelRoot>
  )
}
