import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import { ReplayLibraryEntry, ReplayPlaylist } from '../../common/replays-library'
import { openDialog } from '../dialogs/action-creators'
import { DialogType } from '../dialogs/dialog-type'
import { getGameResultsUrl } from '../games/action-creators'
import {
  GameSidePanel,
  GameSidePanelActions,
  GameSidePanelChipsRow,
  GameSidePanelEmpty,
  GameSidePanelHeader,
  GameSidePanelSection,
  GameSidePanelSubline,
  GameSidePanelTitle,
} from '../games/game-side-panel'
import { PlayerTeamsDisplay } from '../games/player-teams-display'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import Logo from '../logos/logo-no-bg.svg'
import { FilledButton, IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { push } from '../navigation/routing'
import { useAppDispatch } from '../redux-hooks'
import { bodyMedium, labelMedium } from '../styles/typography'
import { useSbGameMap } from './replay-hooks'
import {
  getReplayDisplayTeams,
  playersToDisplayTeams,
  shouldShowTeamLabels,
} from './replay-library-helpers'

const ipcRenderer = new TypedIpcRenderer()

const SbSourceLogo = styled(Logo)`
  width: 16px;
  height: 16px;
`

const SourceBadgeSb = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 4px;

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

const SourceBadgeBnet = styled.div`
  ${labelMedium};

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const ErrorNote = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const WatchButton = styled(FilledButton)`
  flex-grow: 1;
`

const BookmarkButton = styled(IconButton)<{ $bookmarked: boolean }>`
  color: ${props => (props.$bookmarked ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
`

const SectionOverline = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const PlaylistChipsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`

const PlaylistChip = styled.div`
  ${labelMedium};

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

export interface ReplayInspectorProps {
  entry: ReplayLibraryEntry | undefined
  /** True when the list is day-grouped, so the panel's top should align with the first row. */
  alignWithFirstRow: boolean
  playlists: ReadonlyArray<ReplayPlaylist>
  /** Bumped whenever the replay index changes, so this entry's playlist membership stays fresh. */
  changeToken: number
  /** When true, hides the game length (a spoiler) from the panel. */
  spoilerFree: boolean
  /** True when the library is currently scoped to a single playlist. */
  inPlaylistView: boolean
  /** True when the playlist view is showing its manual order, enabling Move up/Move down. */
  canReorder: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onWatch: (entry: ReplayLibraryEntry) => void
  onReveal: (entry: ReplayLibraryEntry) => void
  onToggleBookmark: (entry: ReplayLibraryEntry) => void
  onAddToPlaylist: (playlistId: number, entry: ReplayLibraryEntry) => void
  onRemoveFromPlaylist: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function ReplayInspector({
  entry,
  alignWithFirstRow,
  playlists,
  changeToken,
  spoilerFree,
  inPlaylistView,
  canReorder,
  canMoveUp,
  canMoveDown,
  onWatch,
  onReveal,
  onToggleBookmark,
  onAddToPlaylist,
  onRemoveFromPlaylist,
  onMoveUp,
  onMoveDown,
}: ReplayInspectorProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const computerLabel = t('game.playerName.computer', 'Computer')
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const [addMenuOpen, openAddMenu, closeAddMenu] = usePopoverController({ refreshAnchorPos })
  const map = useSbGameMap(entry?.sbGameId)

  const entryId = entry?.id
  // Tagged with the entry id it was fetched for, so a stale response (or a fetch that hasn't
  // resolved yet after switching entries) never shows another entry's membership.
  const [entryPlaylists, setEntryPlaylists] = useState<{
    forId: number
    list: ReadonlyArray<{ id: number; name: string }>
  }>()

  useEffect(() => {
    if (entryId === undefined) {
      return () => {}
    }

    let canceled = false
    ipcRenderer
      .invoke('replayLibraryGetPlaylistsForReplay', entryId)
      ?.then(result => {
        if (!canceled && result) {
          setEntryPlaylists({ forId: entryId, list: result })
        }
      })
      .catch(swallowNonBuiltins)

    return () => {
      canceled = true
    }
  }, [entryId, changeToken])

  if (!entry) {
    return (
      <GameSidePanelEmpty alignWithFirstRow={alignWithFirstRow}>
        {t('replays.library.inspector.empty', 'Select a replay to see its details')}
      </GameSidePanelEmpty>
    )
  }

  const layout = entry.parseError ? undefined : getReplayDisplayTeams(entry.players)
  const teamLabels =
    layout && shouldShowTeamLabels(layout)
      ? layout.teams.map((_, i) =>
          t('game.teamName.number', { defaultValue: 'Team {{teamNumber}}', teamNumber: i + 1 }),
        )
      : undefined

  const chips = (
    <GameSidePanelChipsRow>
      {entry.sbGameId ? (
        <SourceBadgeSb>
          <SbSourceLogo />
          {t('replays.library.sourceTagSb', 'SB')}
        </SourceBadgeSb>
      ) : (
        <SourceBadgeBnet>{t('replays.library.sourceTagBnet', 'B.NET')}</SourceBadgeBnet>
      )}
    </GameSidePanelChipsRow>
  )

  const bookmarked = entry.bookmarkedAt !== undefined
  const playlistsForEntry =
    entryPlaylists && entryPlaylists.forId === entry.id ? entryPlaylists.list : []

  const actions = (
    <GameSidePanelActions>
      <WatchButton
        label={t('replays.library.watchReplay', 'Watch replay')}
        iconStart={<MaterialIcon icon='play_arrow' />}
        onClick={() => onWatch(entry)}
      />
      <BookmarkButton
        $bookmarked={bookmarked}
        icon={<MaterialIcon icon='bookmark' filled={bookmarked} />}
        title={
          bookmarked
            ? t('replays.library.removeBookmark', 'Remove bookmark')
            : t('replays.library.bookmark', 'Bookmark')
        }
        onClick={() => onToggleBookmark(entry)}
      />
      <IconButton
        ref={anchor}
        icon={<MaterialIcon icon='more_vert' />}
        title={t('replays.library.moreActions', 'More actions')}
        onClick={openMenu}
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
            icon={<MaterialIcon icon='playlist_add' />}
            text={t('replays.library.addToPlaylist', 'Add to playlist…')}
            onClick={event => {
              closeMenu()
              openAddMenu(event)
            }}
          />
          {inPlaylistView ? (
            <MenuItem
              icon={<MaterialIcon icon='playlist_remove' />}
              text={t('replays.library.removeFromPlaylist', 'Remove from playlist')}
              onClick={() => {
                closeMenu()
                onRemoveFromPlaylist()
              }}
            />
          ) : null}
          {inPlaylistView && canReorder ? (
            <MenuItem
              icon={<MaterialIcon icon='arrow_upward' />}
              text={t('replays.library.moveUp', 'Move up')}
              disabled={!canMoveUp}
              onClick={() => {
                closeMenu()
                onMoveUp()
              }}
            />
          ) : null}
          {inPlaylistView && canReorder ? (
            <MenuItem
              icon={<MaterialIcon icon='arrow_downward' />}
              text={t('replays.library.moveDown', 'Move down')}
              disabled={!canMoveDown}
              onClick={() => {
                closeMenu()
                onMoveDown()
              }}
            />
          ) : null}
          {entry.sbGameId && !entry.parseError ? (
            <MenuItem
              icon={<MaterialIcon icon='open_in_new' />}
              text={t('replays.library.viewGamePage', 'View game page')}
              onClick={() => {
                closeMenu()
                push(getGameResultsUrl(entry.sbGameId!))
              }}
            />
          ) : null}
          <MenuItem
            icon={<MaterialIcon icon='folder_open' />}
            text={t('replays.library.showInExplorer', 'Show in Explorer')}
            onClick={() => {
              closeMenu()
              onReveal(entry)
            }}
          />
        </MenuList>
      </Popover>
      <Popover
        open={addMenuOpen}
        onDismiss={closeAddMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          {playlists.map(p => (
            <MenuItem
              key={p.id}
              icon={<MaterialIcon icon='queue_music' />}
              text={p.name}
              onClick={() => {
                closeAddMenu()
                onAddToPlaylist(p.id, entry)
              }}
            />
          ))}
          <MenuItem
            icon={<MaterialIcon icon='add' />}
            text={t('replays.library.newPlaylistMenu', 'New playlist…')}
            onClick={() => {
              closeAddMenu()
              dispatch(
                openDialog({
                  type: DialogType.CreatePlaylist,
                  initData: {
                    onCreated: id => onAddToPlaylist(id, entry),
                  },
                }),
              )
            }}
          />
        </MenuList>
      </Popover>
    </GameSidePanelActions>
  )

  return (
    <GameSidePanel map={map} alignWithFirstRow={alignWithFirstRow}>
      {entry.parseError ? (
        <>
          <GameSidePanelHeader>
            {/*
              No source badge: an unreadable replay's source is genuinely unknown (we couldn't read
              the embedded SB section), so the SB/B.NET distinction can't be made here.
            */}
            <GameSidePanelTitle>{entry.fileName}</GameSidePanelTitle>
          </GameSidePanelHeader>
          <ErrorNote>
            {t('replays.library.inspector.parseError', 'This replay could not be read.')}
          </ErrorNote>
        </>
      ) : (
        <>
          <GameSidePanelHeader>
            {chips}
            {!map ? (
              <GameSidePanelTitle>{filterColorCodes(entry.mapName)}</GameSidePanelTitle>
            ) : null}
            <GameSidePanelSubline>
              <span>{longTimestamp.format(entry.gameTime)}</span>
              {spoilerFree ? null : (
                <>
                  <span>·</span>
                  <span>{getGameDurationString((entry.durationFrames * 1000) / 24)}</span>
                </>
              )}
            </GameSidePanelSubline>
          </GameSidePanelHeader>
          <GameSidePanelSection>
            <PlayerTeamsDisplay
              teams={playersToDisplayTeams(layout!, computerLabel, true)}
              teamLabels={teamLabels}
            />
          </GameSidePanelSection>
        </>
      )}

      {playlistsForEntry.length > 0 ? (
        <GameSidePanelSection>
          <SectionOverline>
            {t('replays.library.inspector.inPlaylists', 'In playlists')}
          </SectionOverline>
          <PlaylistChipsRow>
            {playlistsForEntry.map(p => (
              <PlaylistChip key={p.id}>{p.name}</PlaylistChip>
            ))}
          </PlaylistChipsRow>
        </GameSidePanelSection>
      ) : null}

      {actions}
    </GameSidePanel>
  )
}
