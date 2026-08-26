import { debounce } from 'lodash-es'
import * as React from 'react'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, GroupedVirtuosoHandle, Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from '../../common/games/game-filters'
import { getGameDurationString } from '../../common/games/games'
import { TypedIpcRenderer } from '../../common/ipc'
import { filterColorCodes } from '../../common/maps'
import {
  FEATURED_REPLAY_GAME_TYPES,
  replayGameTypeToLabel,
  SupportedReplayGameType,
} from '../../common/replays'
import {
  ReplayBackfillProgress,
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
  ReplayPlaylist,
} from '../../common/replays-library'
import { useContextMenu } from '../dom/use-context-menu'
import {
  DayHeader,
  formatDayHeaderLabel,
  getDayBoundaries,
  resolveDateRangeMs,
} from '../games/day-header'
import { GameFilterBar } from '../games/game-filter-bar'
import { parseMatchup } from '../games/game-filter-url'
import {
  GameListEntryLayout,
  GameRelativeTime,
  SelectableRowContainer,
} from '../games/game-list-entry'
import { PlayerTeamsDisplay } from '../games/player-teams-display'
import { useRememberedFilters } from '../games/use-remembered-filters'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import logger from '../logging/logger'
import { IconButton, TextButton, useButtonState } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController } from '../material/popover'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { useHistoryEntryKey, useLocationSearchParam } from '../navigation/router-hooks'
import { push, replace } from '../navigation/routing'
import { createViewStateStore } from '../navigation/view-state-store'
import { useVirtuosoScrollMemory } from '../navigation/virtuoso-scroll-memory'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppDispatch } from '../redux-hooks'
import { useSnackbarController } from '../snackbars/snackbar-overlay'
import { CenteredContentContainer } from '../styles/centered-container'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import { bodyLarge, bodyMedium, singleLine, titleLarge, titleSmall } from '../styles/typography'
import { startReplay } from './action-creators'
import {
  getAddToPlaylistMenuItems,
  getReplayActionMenuItems,
  ReplayInspector,
} from './replay-inspector'
import {
  encodeViewPathname,
  getReplayDisplayTeams,
  groupReplaysByDay,
  isManualPlaylistOrder,
  LibraryView,
  playersToDisplayTeams,
} from './replay-library-helpers'
import { ReplayLibraryRail } from './replay-library-rail'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/** Number of replay entries fetched per infinite-scroll chunk. */
const LOAD_CHUNK_SIZE = 100

// TTL must match useVirtuosoScrollMemory's: the saved scroll state and the saved entry window
// restore together, and a scroll restored into a missing window would clamp against a single
// fresh page. Both are stamped when the user leaves the page.
const WINDOW_MAX_AGE_MS = 30 * 60 * 1000

interface ReplayListWindow {
  entries: ReadonlyArray<ReplayLibraryEntry>
  total: number | undefined
}

const windowCache = createViewStateStore<ReplayListWindow>('replay-library', {
  maxAgeMs: WINDOW_MAX_AGE_MS,
})

const focusedIdCache = createViewStateStore<number>('replay-library-selection', {
  maxAgeMs: WINDOW_MAX_AGE_MS,
})

interface RailSnapshot {
  status: ReplayLibraryStatus | undefined
  backfill: ReplayBackfillProgress | undefined
  playlists: ReadonlyArray<ReplayPlaylist>
}

// The rail's data (index counts, backfill progress, playlists) is library-wide rather than
// per-visit, but it's fetched and owned by `ReplayLibrary`, which remounts on every view change
// (keyed in `ReplaysRoot`). Seeding each mount from the previous instance's latest values keeps
// the rail stable across that remount — without it, the rail would blank (counts at zero, playlist
// rows gone) until the mount-time fetches answer. The fetches still run and replace the seed.
let railSnapshot: RailSnapshot = { status: undefined, backfill: undefined, playlists: [] }

function parseDuration(value: string): GameDurationFilter {
  return Object.values(GameDurationFilter).includes(value as GameDurationFilter)
    ? (value as GameDurationFilter)
    : GameDurationFilter.All
}

function parseSort(value: string): GameSortOption {
  return Object.values(GameSortOption).includes(value as GameSortOption)
    ? (value as GameSortOption)
    : GameSortOption.LatestFirst
}

function parseFormat(value: string): GameFormat | undefined {
  return ALL_GAME_FORMATS.includes(value as GameFormat) ? (value as GameFormat) : undefined
}

function parseModeFilter(value: string): SupportedReplayGameType | 'others' | undefined {
  if (value === 'others') {
    return 'others'
  }
  const parsed = Number.parseInt(value, 10)
  return (FEATURED_REPLAY_GAME_TYPES as readonly number[]).includes(parsed)
    ? (parsed as SupportedReplayGameType)
    : undefined
}

interface BuildFiltersParams {
  view: LibraryView
  /**
   * `undefined` in a playlist's manual order, which the query treats as "use the playlist's
   * arrangement".
   */
  sort: GameSortOption | undefined
  mapName: string
  playerName: string
  gameType: number | 'others' | undefined
  duration: GameDurationFilter
  format: GameFormat | undefined
  matchup: EncodedMatchupString | undefined
  startDate: string
  endDate: string
  includeShort: boolean
}

/** Assembles the query filters (everything but paging) from the current view and filter/sort values. */
function buildFilters({
  view,
  sort,
  mapName,
  playerName,
  gameType,
  duration,
  format,
  matchup,
  startDate,
  endDate,
  includeShort,
}: BuildFiltersParams): ReplayLibraryFilters {
  const filters: ReplayLibraryFilters = {}
  if (view.kind === 'bookmarked') {
    filters.bookmarked = true
  } else if (view.kind === 'playlist') {
    filters.playlistId = view.id
  }
  if (sort !== undefined) filters.sort = sort
  if (mapName) filters.mapName = mapName
  if (playerName) filters.playerName = playerName
  if (gameType !== undefined) filters.gameType = gameType
  if (duration !== GameDurationFilter.All) filters.duration = duration
  if (format !== undefined) {
    filters.format = format
    if (matchup) filters.matchup = matchup
  }
  const { startMs, endMs } = resolveDateRangeMs(startDate, endDate)
  if (startMs !== undefined) filters.gameTimeFrom = startMs
  if (endMs !== undefined) filters.gameTimeTo = endMs
  if (includeShort) filters.includeShort = true
  return filters
}

// ---- Layout ----------------------------------------------------------------------------------

const PageColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 100%;
  padding: 24px 0;
`

const BodyRow = styled.div`
  /*
    Named container so descendants (e.g. the library rail) can adapt to the actual space this row
    gets — which depends on the window size *and* the social sidebar — rather than the viewport.
  */
  container: replay-library-body / inline-size;

  display: flex;
  flex-direction: row;
  gap: 24px;
`

const ListColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  /*
    Named container so row cells (see game-list-entry.tsx) can adapt to the actual width rows get,
    which is narrower than the replay-library-body container above once the rail's own width is
    subtracted — rather than reacting to a width that still includes the rail.
  */
  container: game-list-rows / inline-size;
`

// ---- Empty / loading states ------------------------------------------------------------------

const CenteredState = styled.div`
  ${bodyLarge};

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;

  min-height: 320px;
  padding: 32px;
  text-align: center;

  color: var(--theme-on-surface-variant);
`

const EmptyStateTitle = styled.div`
  ${titleLarge};
  color: var(--theme-on-surface);
`

const EmptyStatePath = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
  word-break: break-all;
`

const UnavailableIcon = styledWithAttrs(MaterialIcon, { icon: 'error', size: 40 })`
  color: var(--theme-error);
`

/**
 * Shown when the main-process replay library service isn't answering (its IPC handlers never
 * registered, e.g. because the SQLite module failed to load), so there's nothing to query.
 */
export function ReplayLibraryUnavailable() {
  const { t } = useTranslation()
  return (
    <CenteredState>
      <UnavailableIcon />
      <EmptyStateTitle>
        {t('replays.library.unavailable', 'Replay library unavailable')}
      </EmptyStateTitle>
      <div>
        {t(
          'replays.library.unavailableBody',
          "Your replays couldn't be loaded right now. Restarting ShieldBattery usually fixes this.",
        )}
      </div>
    </CenteredState>
  )
}

// ---- Row -------------------------------------------------------------------------------------

const ParseErrorPlayers = styled.div`
  ${titleSmall};

  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;

  color: var(--theme-on-surface-variant);
`

const ParseErrorFileName = styled.span`
  ${singleLine};
  min-width: 0;
`

const RowErrorIcon = styledWithAttrs(MaterialIcon, { icon: 'error', size: 20 })`
  flex-shrink: 0;
  color: var(--theme-error);
`

// Sized below the map cell's height so it doesn't set the row's floor: that keeps a single-team
// (1v1) row compact while multi-player team rows grow taller from their stacked player rows,
// preserving the visual difference between 1v1 and team matchups.
const RowBookmarkButton = styled(IconButton)<{ $bookmarked: boolean }>`
  width: 40px;
  min-height: 40px;
  height: 40px;

  color: ${props => (props.$bookmarked ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
`

interface ReplayListEntryProps {
  entry: ReplayLibraryEntry
  selected: boolean
  computerLabel: string
  bookmarkTitle: string
  removeBookmarkTitle: string
  /** When true, hides the game length (a spoiler) from the row. */
  spoilerFree: boolean
  onSelect: (id: number) => void
  onWatch: (entry: ReplayLibraryEntry) => void
  onToggleBookmark: (entry: ReplayLibraryEntry) => void
  onContextMenu: (entry: ReplayLibraryEntry, event: React.MouseEvent) => void
}

function ReplayListEntry({
  entry,
  selected,
  computerLabel,
  bookmarkTitle,
  removeBookmarkTitle,
  spoilerFree,
  onSelect,
  onWatch,
  onToggleBookmark,
  onContextMenu,
}: ReplayListEntryProps) {
  const { t } = useTranslation()
  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => onSelect(entry.id),
    onDoubleClick: () => onWatch(entry),
  })

  const bookmarked = entry.bookmarkedAt !== undefined

  // Unreadable replays keep the (empty) bookmark column so their cells stay aligned with real rows,
  // but there's nothing worth coming back to, so they aren't bookmarkable.
  const bookmark = entry.parseError ? (
    <></>
  ) : (
    <Tooltip text={bookmarked ? removeBookmarkTitle : bookmarkTitle} position='right'>
      <RowBookmarkButton
        $bookmarked={bookmarked}
        icon={<MaterialIcon icon='bookmark' filled={bookmarked} />}
        onClick={event => {
          event.stopPropagation()
          onToggleBookmark(entry)
        }}
      />
    </Tooltip>
  )

  const players = entry.parseError ? (
    <ParseErrorPlayers>
      <RowErrorIcon />
      <ParseErrorFileName>{entry.fileName}</ParseErrorFileName>
    </ParseErrorPlayers>
  ) : (
    <PlayerTeamsDisplay
      teams={playersToDisplayTeams(getReplayDisplayTeams(entry.players), computerLabel)}
    />
  )

  return (
    <SelectableRowContainer
      {...buttonProps}
      $selected={selected}
      onContextMenu={event => onContextMenu(entry, event)}>
      <GameListEntryLayout
        bookmark={bookmark}
        players={players}
        relativeTime={
          // A parse-error row's `gameTime` isn't a real timestamp (see `ReplayLibraryEntry`), so
          // there's nothing meaningful to show — but the empty node still reserves the column.
          entry.parseError ? <></> : <GameRelativeTime timestampMs={entry.gameTime} />
        }
        duration={
          entry.parseError || spoilerFree
            ? '—'
            : getGameDurationString((entry.durationFrames * 1000) / 24)
        }
        mapName={entry.parseError ? '—' : filterColorCodes(entry.mapName)}
        gameTypeLabel={entry.parseError ? '' : replayGameTypeToLabel(entry.gameType, t)}
      />
      <Ripple ref={rippleRef} />
    </SelectableRowContainer>
  )
}

// ---- Main component --------------------------------------------------------------------------

export interface ReplayLibraryProps {
  view: LibraryView
}

export function ReplayLibrary({ view }: ReplayLibraryProps) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const snackbarController = useSnackbarController()

  const entryKey = useHistoryEntryKey()
  // Read once per mount: the store contract allows a lazy initializer since it runs at most once
  // and so never re-reads on a re-render.
  const [initialWindow] = useState(() =>
    entryKey !== undefined ? windowCache.get(entryKey) : undefined,
  )

  const [entries, setEntries] = useState<ReadonlyArray<ReplayLibraryEntry> | undefined>(
    initialWindow?.entries,
  )
  const [total, setTotal] = useState<number | undefined>(initialWindow?.total)
  const [isLoadingNext, setIsLoadingNext] = useState(false)
  const [status, setStatus] = useState<ReplayLibraryStatus | undefined>(() => railSnapshot.status)
  const [backfill, setBackfill] = useState<ReplayBackfillProgress | undefined>(
    () => railSnapshot.backfill,
  )
  // Set when the status query rejects, which in practice means the main-process replay library
  // service failed to start (e.g. the SQLite module couldn't load) and none of its IPC handlers are
  // registered — so every query would hang. We surface that instead of spinning forever.
  const [unavailable, setUnavailable] = useState(false)
  const [playlists, setPlaylists] = useState<ReadonlyArray<ReplayPlaylist>>(
    () => railSnapshot.playlists,
  )
  // Bumped on every index change so entry-scoped fetches (e.g. the inspector's playlist
  // membership) know to refresh.
  const [changeToken, setChangeToken] = useState(0)
  const [observerToken, restartObserver] = useRefreshToken()

  const [focusedId, setFocusedId] = useState<number | undefined>(() =>
    entryKey !== undefined ? focusedIdCache.get(entryKey) : undefined,
  )
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const groupedRef = useRef<GroupedVirtuosoHandle>(null)
  const flatRef = useRef<VirtuosoHandle>(null)

  // Only one of the two lists is mounted at a time (see `useFlatList`), so state capture reads
  // whichever handle is live.
  const [virtuosoStateRef] = useState(() => ({
    get current(): GroupedVirtuosoHandle | VirtuosoHandle | null {
      return groupedRef.current ?? flatRef.current
    },
  }))
  const restoredSnapshot = useVirtuosoScrollMemory(scrollParent, virtuosoStateRef)
  // A filter/sort change replaces the URL in place, keeping the same visit key, so the snapshot
  // captured for this entry no longer matches the list contents once any reset happens — after
  // that it must not re-apply when the (remounting) list comes back with new data. View changes
  // don't hit this: they push a new pathname and remount the component under a new visit.
  const [snapshotInvalidated, setSnapshotInvalidated] = useState(false)
  const restoreStateFrom = snapshotInvalidated ? undefined : restoredSnapshot

  // Right-click on a row selects it and opens this menu at the cursor, offering the same actions
  // as the inspector's overflow menu.
  const { onContextMenu: openRowContextMenu, contextMenuPopoverProps } = useContextMenu()
  const [addToPlaylistMenuOpen, openAddToPlaylistMenu, closeAddToPlaylistMenu] =
    usePopoverController()

  // Guards against IPC responses for a query that's since been superseded by a `reset()` (e.g. the
  // user changed filters while a request was in flight).
  const queryEpochRef = useRef(0)

  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [gameTypeParam, setGameTypeParam] = useLocationSearchParam('gameType')
  const [startDate, setStartDateParam] = useLocationSearchParam('startDate')
  const [endDate, setEndDateParam] = useLocationSearchParam('endDate')
  const [includeShortParam, setIncludeShortParam] = useLocationSearchParam('includeShort')

  // The library's mode-like filters are remembered per user across visits, with every view (the
  // whole library, bookmarks, each playlist) sharing one saved set. Each view names only the
  // params it actually uses, so a preference a view can't express is neither seeded into its URL
  // nor counted as "the URL specifies the filters" there (saved entries outside a view's params
  // survive its saves untouched).
  const rememberedUrlValues: Record<string, string> = {
    duration: durationParam,
    gameType: gameTypeParam,
  }
  if (view.kind !== 'playlist') {
    // Inside a playlist an absent sort means the playlist's manual order, and nothing there ever
    // writes an absent sort back (every menu choice is explicit, and Clear leaves sort alone) — so
    // seeding a remembered sort would make drag-to-reorder permanently unreachable.
    rememberedUrlValues.sort = sortParam
  }
  if (view.kind === 'all') {
    rememberedUrlValues.includeShort = includeShortParam
  }
  const { values: filterValues, save: saveFilterPrefs } = useRememberedFilters(
    'replays',
    rememberedUrlValues,
  )

  // A playlist reads sort straight from the URL: absent means its manual order, never a
  // remembered fill-in.
  const sortValue = view.kind === 'playlist' ? sortParam : filterValues.sort

  const duration = parseDuration(filterValues.duration)
  const sort = parseSort(sortValue)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam, format)
  const gameType = parseModeFilter(filterValues.gameType)
  // The minimum-length floor never applies to curation views (bookmarked/playlist) — see
  // `buildReplaySqlQuery` — so `includeShort` is meaningless there: it isn't read (a hand-edited
  // URL param must not disable reordering via `hasActiveFilters`), seeded, or saved, and the
  // checkbox isn't offered.
  const includeShort = view.kind === 'all' && filterValues.includeShort === 'true'

  const computerLabel = t('game.playerName.computer', 'Computer')
  const bookmarkTitle = t('replays.library.bookmark', 'Bookmark')
  const removeBookmarkTitle = t('replays.library.removeBookmark', 'Remove bookmark')

  // Remembered per-user, shared with the games and match history pages: hides the game length (a
  // spoiler) from the list rows and the inspector.
  const [spoilerFree, setSpoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)

  // The view is navigation rather than a filter: it isn't included here, and clearing filters
  // leaves it alone.
  const hasActiveFilters =
    duration !== GameDurationFilter.All ||
    !!mapName ||
    !!playerName ||
    !!format ||
    !!matchup ||
    gameType !== undefined ||
    !!startDate ||
    !!endDate ||
    includeShort

  const isDurationSort =
    sort === GameSortOption.ShortestFirst || sort === GameSortOption.LongestFirst
  const manualOrder = isManualPlaylistOrder(view, sortValue)
  // A playlist's manual order has no meaningful day boundaries, so it renders flat like the
  // duration sorts do.
  const useFlatList = isDurationSort || manualOrder
  const effectiveSort = manualOrder ? undefined : sort

  const reset = () => {
    queryEpochRef.current += 1
    setEntries(undefined)
    setTotal(undefined)
    setIsLoadingNext(false)
    setSnapshotInvalidated(true)
    restartObserver()
  }

  // Fetches the index status. Called once on mount and again (debounced) on every index change.
  const fetchStatus = useEffectEvent(() => {
    ipcRenderer
      .invoke('replayLibraryStatus')
      ?.then(result => {
        if (result) {
          setStatus(result)
          setBackfill(result.backfill)
          setUnavailable(false)
        }
      })
      .catch(() => {
        // A rejection here means the service isn't answering (see `unavailable`); mark it so the UI
        // can explain the failure rather than loading indefinitely.
        setUnavailable(true)
      })
  })

  // Re-queries just the currently-loaded window of entries (offset 0, enough to cover what's
  // already been loaded) and replaces it wholesale. Used to pick up backfill progress and
  // added/removed files without collapsing the user's scroll position.
  const refreshLoadedWindow = useEffectEvent(() => {
    // Invalidate any in-flight next-page load: it computed its offset against the pre-refresh
    // entries, so letting it append after the wholesale replacement would leave a gap in the
    // loaded window (which the id-dedupe in `onLoadNextData` can then never fill). Clearing
    // `isLoadingNext` here is required for the same reason — the invalidated load's `finally`
    // deliberately won't touch it once its epoch is stale.
    queryEpochRef.current += 1
    setIsLoadingNext(false)
    const epoch = queryEpochRef.current
    const limit = Math.max(LOAD_CHUNK_SIZE, entries?.length ?? 0)

    ipcRenderer
      .invoke('replayLibraryQuery', {
        ...buildFilters({
          view,
          sort: effectiveSort,
          mapName,
          playerName,
          gameType,
          duration,
          format,
          matchup,
          startDate,
          endDate,
          includeShort,
        }),
        offset: 0,
        limit,
      })
      ?.then(result => {
        if (epoch !== queryEpochRef.current || !result) return
        setEntries(result.entries)
        setTotal(result.total)
      })
      .catch(swallowNonBuiltins)
  })

  // Fetches the playlists for the rail. Called once on mount and again (debounced) on every index
  // change. Doubles as the consistency check for the current view: if the playlist being viewed no
  // longer exists (deleted, or a stale URL), the URL is corrected in place to the whole library —
  // the replace keeps the visit key while the parent's view-keyed remount swaps in a fresh instance.
  const fetchPlaylists = useEffectEvent(() => {
    ipcRenderer
      .invoke('replayLibraryListPlaylists')
      ?.then(result => {
        if (!result) return
        setPlaylists(result)
        if (view.kind === 'playlist' && !result.some(p => p.id === view.id)) {
          replace(encodeViewPathname({ kind: 'all' }) + window.location.search)
        }
      })
      .catch(swallowNonBuiltins)
  })

  // Re-runs everything the debounced `replayLibraryChanged` listener below refreshes: the loaded
  // window, status/backfill, and playlists, plus bumping the change token.
  const refreshAfterChange = useEffectEvent(() => {
    refreshLoadedWindow()
    fetchStatus()
    fetchPlaylists()
    setChangeToken(token => token + 1)
  })

  // Lets a plain event handler (not an Effect) ask for the same refresh `refreshAfterChange`
  // performs, to correct an optimistic update that turned out to be wrong -- e.g. a failed trash
  // attempt -- without hand-rolling a manual revert. Effect Events may only be called from Effects,
  // so the handler bumps this token instead of calling `refreshAfterChange` itself; the effect
  // below does the actual call. The first run (mount) is skipped since the other effects here
  // already fetch everything fresh on mount.
  const [correctionToken, triggerCorrection] = useRefreshToken()
  const skipInitialCorrectionRef = useRef(true)
  useEffect(() => {
    if (skipInitialCorrectionRef.current) {
      skipInitialCorrectionRef.current = false
      return
    }
    refreshAfterChange()
  }, [correctionToken])

  // Listen for index change + backfill events only while mounted.
  useEffect(() => {
    fetchStatus()
    fetchPlaylists()
    if (initialWindow !== undefined) {
      // The index can change while the page is unmounted (files added/removed, backfill progress)
      // with nothing listening for the change events, so a restored window is re-queried
      // immediately; the wholesale replacement keeps the restored scroll position.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time refresh of a restored window on mount
      refreshLoadedWindow()
    }

    const handleChanged = debounce(() => {
      refreshAfterChange()
    }, 300)
    const handleProgress = (_event: unknown, progress: ReplayBackfillProgress | undefined) => {
      setBackfill(progress)
    }
    ipcRenderer.on('replayLibraryChanged', handleChanged)
    ipcRenderer.on('replayLibraryBackfillProgress', handleProgress)

    return () => {
      handleChanged.cancel()
      // These channels are only ever listened to by this component, so removing all listeners is
      // equivalent to (and simpler than) tracking each handler reference for removal.
      ipcRenderer.removeAllListeners('replayLibraryChanged')
      ipcRenderer.removeAllListeners('replayLibraryBackfillProgress')
    }
  }, [initialWindow])

  // Mirrored on every change (rather than written through in each setter) so functional updates —
  // e.g. the optimistic bookmark-count bump in `toggleBookmark` — are captured too.
  useEffect(() => {
    railSnapshot = { status, backfill, playlists }
  }, [status, backfill, playlists])

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Written at cleanup time (unmount), not as `entries`/`total` change: the store stamps its TTL
    // at write time, and this needs to match when the scroll state is saved — also at unmount — so
    // the two entries expire together.
    return () => {
      if (entries !== undefined) {
        windowCache.set(entryKey, { entries, total })
      } else {
        // `reset()` (a filter/sort/view change) clears `entries` while replacing the URL in place
        // under the same visit key. If the user leaves before the first page under the new filters
        // arrives, the old filters' entry must not survive to be restored against the new URL.
        windowCache.delete(entryKey)
      }
    }
  }, [entryKey, entries, total])

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Cleanup-time write, matching the window save's timing: a selection is never un-made (a
    // restored id absent from the current list just falls back to the first row), so unlike the
    // entry window there's nothing to delete here.
    return () => {
      if (focusedId !== undefined) {
        focusedIdCache.set(entryKey, focusedId)
      }
    }
  }, [entryKey, focusedId])

  const loadedEntries = entries ?? []
  const focusedEntry = loadedEntries.find(e => e.id === focusedId) ?? loadedEntries[0]
  const focusedIndex = focusedEntry ? loadedEntries.findIndex(e => e.id === focusedEntry.id) : -1

  const watchEntry = (entry: ReplayLibraryEntry) => {
    dispatch(startReplay({ path: entry.path, name: entry.fileName }))
  }
  const revealEntry = (entry: ReplayLibraryEntry) => {
    ipcRenderer.invoke('pathsShowItemInFolder', entry.path)?.catch(swallowNonBuiltins)
  }

  const trashEntry = (entry: ReplayLibraryEntry) => {
    const wasBookmarked = entry.bookmarkedAt !== undefined
    // Hand focus to a neighboring row before the entry disappears — otherwise the stale
    // `focusedId` would make the focused-entry fallback jump the selection (and the inspector) to
    // the first row.
    if (entry.id === focusedEntry?.id) {
      const index = loadedEntries.findIndex(e => e.id === entry.id)
      const neighbor = loadedEntries[index + 1] ?? loadedEntries[index - 1]
      setFocusedId(neighbor?.id)
    }
    // Update optimistically, same as `toggleBookmark`: the watcher notices the file's removal on
    // its own and its resulting index-changed event will confirm this shortly. A rejection means
    // nothing actually changed on disk, so it's corrected via the same refresh that event uses.
    setEntries(prev => prev?.filter(e => e.id !== entry.id))
    setTotal(prev => (prev !== undefined ? Math.max(0, prev - 1) : prev))
    if (wasBookmarked) {
      setStatus(prev =>
        prev ? { ...prev, bookmarkedCount: Math.max(0, prev.bookmarkedCount - 1) } : prev,
      )
    }

    ipcRenderer
      .invoke('replayLibraryTrashReplay', entry.path)
      ?.then(trashed => {
        if (trashed) {
          snackbarController.showSnackbar(
            t('replays.library.movedToRecycleBin', 'Replay moved to Recycle Bin'),
          )
        }
        // `trashed: false` means the file was already gone, which the optimistic removal above
        // already reflects correctly -- nothing further to do.
      })
      .catch(err => {
        logger.error(`Error moving replay to Recycle Bin: ${getErrorStack(err)}`)
        snackbarController.showSnackbar(
          t('replays.library.moveToRecycleBinError', 'Something went wrong removing the replay'),
        )
        triggerCorrection()
      })
  }

  const handleRowContextMenu = (entry: ReplayLibraryEntry, event: React.MouseEvent) => {
    setFocusedId(entry.id)
    openRowContextMenu(event)
  }

  const toggleBookmark = (entry: ReplayLibraryEntry) => {
    const bookmarked = entry.bookmarkedAt === undefined
    // Update optimistically; the resulting index-changed event will confirm (or correct) shortly.
    setEntries(prev =>
      prev?.map(e =>
        e.id === entry.id ? { ...e, bookmarkedAt: bookmarked ? Date.now() : undefined } : e,
      ),
    )
    setStatus(prev =>
      prev
        ? { ...prev, bookmarkedCount: Math.max(0, prev.bookmarkedCount + (bookmarked ? 1 : -1)) }
        : prev,
    )
    ipcRenderer
      .invoke('replayLibrarySetBookmarked', entry.id, bookmarked)
      ?.catch(swallowNonBuiltins)
  }

  const addToPlaylist = (playlistId: number, entry: ReplayLibraryEntry) => {
    ipcRenderer
      .invoke('replayLibraryAddToPlaylist', playlistId, [entry.id])
      ?.catch(swallowNonBuiltins)
  }

  const removeFromCurrentPlaylist = (entry: ReplayLibraryEntry) => {
    if (view.kind !== 'playlist') return
    ipcRenderer
      .invoke('replayLibraryRemoveFromPlaylist', view.id, [entry.id])
      ?.catch(swallowNonBuiltins)
  }

  // Move up/down sends the loaded index directly as an absolute playlist position, which is only
  // correct when the loaded list is the complete playlist in manual order (contiguous from offset
  // 0, ordered purely by position). Value filters break that: they subset the list, so a loaded
  // index no longer maps to a playlist position.
  const canReorder = manualOrder && !hasActiveFilters
  const moveFocusedBy = (delta: number) => {
    if (view.kind !== 'playlist' || !canReorder || !focusedEntry || focusedIndex < 0) return
    const toIndex = focusedIndex + delta
    if (toIndex < 0 || toIndex >= (total ?? loadedEntries.length)) return
    ipcRenderer
      .invoke('replayLibraryMovePlaylistEntry', view.id, focusedEntry.id, toIndex)
      ?.catch(swallowNonBuiltins)
  }

  const canMoveUp = canReorder && focusedIndex > 0
  const canMoveDown =
    canReorder && focusedIndex >= 0 && focusedIndex < (total ?? loadedEntries.length) - 1

  const scrollToIndex = (index: number) => {
    // Only one of these lists is mounted at a time, so the other ref is null.
    groupedRef.current?.scrollIntoView({ index })
    flatRef.current?.scrollIntoView({ index })
  }
  const focusIndex = (index: number) => {
    if (index < 0 || index >= loadedEntries.length) return
    setFocusedId(loadedEntries[index].id)
    scrollToIndex(index)
  }
  const moveFocus = (delta: number) => {
    if (loadedEntries.length === 0) return
    const base = focusedIndex < 0 ? 0 : focusedIndex
    const next = Math.min(Math.max(base + delta, 0), loadedEntries.length - 1)
    focusIndex(next)
  }

  const onLoadNextData = () => {
    setIsLoadingNext(true)
    const epoch = queryEpochRef.current

    ipcRenderer
      .invoke('replayLibraryQuery', {
        ...buildFilters({
          view,
          sort: effectiveSort,
          mapName,
          playerName,
          gameType,
          duration,
          format,
          matchup,
          startDate,
          endDate,
          includeShort,
        }),
        offset: entries?.length ?? 0,
        limit: LOAD_CHUNK_SIZE,
      })
      ?.then(result => {
        if (epoch !== queryEpochRef.current || !result) return
        // The index can change between fetches (files added/removed), so the same offset can
        // re-serve entries we've already loaded; dedupe on append to avoid duplicate React keys.
        setEntries(prev => {
          const existingIds = new Set((prev ?? []).map(e => e.id))
          return (prev ?? []).concat(result.entries.filter(e => !existingIds.has(e.id)))
        })
        setTotal(result.total)
      })
      .catch(swallowNonBuiltins)
      .finally(() => {
        if (epoch === queryEpochRef.current) {
          setIsLoadingNext(false)
        }
      })
  }

  const hasNextData = entries === undefined || (total !== undefined && entries.length < total)

  const clearAllFilters = () => {
    setDurationParam('')
    setMapNameParam('')
    setPlayerNameParam('')
    setFormatParam('')
    setMatchupParam('')
    setGameTypeParam('')
    setStartDateParam('')
    setEndDateParam('')
    setIncludeShortParam('')
    saveFilterPrefs()
    reset()
    // `sort` is a view option (not a filter), so it's intentionally left untouched — including in
    // the remembered set, which `saveFilterPrefs` rewrites from the params that remain.
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      // Every key here acts on the replay list, but this page's key listener boundary is shared
      // with other UI (e.g. the social sidebar's chat input, whose keydowns bubble to the
      // document). While a text-entry element has focus, the keystroke belongs to it: without
      // this, pressing Delete while typing in chat would remove the focused replay from a
      // playlist, and Enter would launch the replay.
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return false
      }

      switch (event.code) {
        case 'ArrowUp':
          moveFocus(-1)
          return true
        case 'ArrowDown':
          moveFocus(1)
          return true
        case 'PageUp':
          moveFocus(-10)
          return true
        case 'PageDown':
          moveFocus(10)
          return true
        case 'Home':
          focusIndex(0)
          return true
        case 'End':
          focusIndex(loadedEntries.length - 1)
          return true
        case 'Delete':
          // Removes from the current playlist only; replay files on disk are never touched.
          if (view.kind === 'playlist' && focusedEntry) {
            removeFromCurrentPlaylist(focusedEntry)
            return true
          }
          return false
        case ENTER:
        case ENTER_NUMPAD: {
          const active = document.activeElement
          // If the user is on an interactive control (e.g. a focused button), let it handle Enter.
          if (
            active instanceof HTMLElement &&
            (active.tagName === 'BUTTON' || active.tagName === 'A')
          ) {
            return false
          }
          if (focusedEntry) watchEntry(focusedEntry)
          return true
        }
      }

      return false
    },
  })

  const dayGroups = groupReplaysByDay(loadedEntries)
  const groupCounts = dayGroups.map(g => g.entries.length)
  const { todayStartMs, yesterdayStartMs } = getDayBoundaries()

  const renderRow = (index: number) => {
    const entry = loadedEntries[index]
    if (!entry) return null
    return (
      <ReplayListEntry
        entry={entry}
        selected={entry.id === focusedEntry?.id}
        computerLabel={computerLabel}
        bookmarkTitle={bookmarkTitle}
        removeBookmarkTitle={removeBookmarkTitle}
        spoilerFree={spoilerFree}
        onSelect={setFocusedId}
        onWatch={watchEntry}
        onToggleBookmark={toggleBookmark}
        onContextMenu={handleRowContextMenu}
      />
    )
  }

  let listContent: React.ReactNode = null
  if (entries === undefined) {
    // The backfill's own progress rides in the bar above the list; here we just need a light loader
    // until the first page resolves.
    listContent = <LoadingDotsArea />
  } else if (entries.length === 0) {
    if (hasActiveFilters) {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.noMatches', 'No replays match')}</EmptyStateTitle>
          <TextButton
            label={t('replays.library.clearFilters', 'Clear filters')}
            iconStart={<MaterialIcon icon='close' />}
            onClick={clearAllFilters}
          />
        </CenteredState>
      )
    } else if (view.kind === 'bookmarked') {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>
            {t('replays.library.bookmarkedEmpty', 'No bookmarked replays')}
          </EmptyStateTitle>
          <div>
            {t('replays.library.bookmarkedEmptyBody', 'Bookmark replays to keep them handy here.')}
          </div>
        </CenteredState>
      )
    } else if (view.kind === 'playlist') {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>
            {t('replays.library.playlistEmpty', 'This playlist is empty')}
          </EmptyStateTitle>
          <div>{t('replays.library.playlistEmptyBody', 'Add replays to it from the library.')}</div>
        </CenteredState>
      )
    } else if (status && status.watchedFolders.length === 0) {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.noFolders', 'No replay folders')}</EmptyStateTitle>
          <div>
            {t(
              'replays.library.noFoldersBody',
              'Add a folder in Settings > App > System to start indexing replays.',
            )}
          </div>
        </CenteredState>
      )
    } else if (backfill) {
      // A backfill is still populating the index (progress shows in the bar above); don't claim
      // there are no replays while it's just getting started.
      listContent = <LoadingDotsArea />
    } else {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>{t('replays.library.empty', 'No replays yet')}</EmptyStateTitle>
          <div>
            {t(
              'replays.library.emptyBody',
              'Replays you watch and play will show up here automatically.',
            )}
          </div>
          {status?.watchedFolders.map(folder => (
            <EmptyStatePath key={folder}>{folder}</EmptyStatePath>
          ))}
        </CenteredState>
      )
    }
  } else if (scrollParent) {
    // NOTE: `Virtuoso` and `GroupedVirtuoso` share the same underlying component type, so
    // switching between them reconciles as a prop update and leaves stale group state behind.
    // Distinct keys force a full remount when the list mode changes.
    listContent = useFlatList ? (
      <Virtuoso
        key='flat'
        ref={flatRef}
        customScrollParent={scrollParent}
        restoreStateFrom={restoreStateFrom}
        totalCount={loadedEntries.length}
        itemContent={renderRow}
      />
    ) : (
      <GroupedVirtuoso
        key='grouped'
        ref={groupedRef}
        customScrollParent={scrollParent}
        restoreStateFrom={restoreStateFrom}
        groupCounts={groupCounts}
        groupContent={index => {
          const group = dayGroups[index]
          // Intentionally no per-day count: the list is paginated, so a count from the loaded rows
          // would understate the oldest loaded day until it's fully scrolled (see day-header.tsx).
          return (
            <DayHeader
              label={
                group.unreadable
                  ? t('replays.library.unreadableReplays', 'Unreadable replays')
                  : formatDayHeaderLabel(group.dayStartMs, todayStartMs, yesterdayStartMs, t)
              }
            />
          )
        }}
        itemContent={renderRow}
      />
    )
  }

  // The backfill progress rides in the rail beneath the library counts. The scanning phase (total
  // unknown) is only surfaced while the list is still empty — an already-populated library re-scans
  // on every startup with no work to do, and a flashing "Scanning…" there would just be noise.
  const railBackfill =
    backfill && (backfill.phase === 'indexing' || loadedEntries.length === 0) ? backfill : undefined

  // A view with no replays has nothing to inspect, so the panel is dropped entirely (letting the
  // list fill the width) rather than showing an empty "select a replay" placeholder beside the
  // empty-state message. It's kept while the query is still in flight (`entries === undefined`) so
  // it doesn't flicker out and back in on filter/view changes, which briefly clear the entries.
  const showInspector = entries === undefined || loadedEntries.length > 0

  if (unavailable) {
    // The whole feature depends on the main-process service, so when it's down there's nothing to
    // filter or browse — replace the page with a plain explanation rather than dead chrome.
    return (
      <CenteredContentContainer $targetWidth={1280}>
        <PageColumn>
          <ReplayLibraryUnavailable />
        </PageColumn>
      </CenteredContentContainer>
    )
  }

  return (
    <CenteredContentContainer ref={setScrollParent} $fullWidth={true} data-content-fullbleed=''>
      <PageColumn>
        <GameFilterBar
          showRankedCustom={false}
          duration={duration}
          setDuration={v => {
            setDurationParam(v === GameDurationFilter.All ? '' : v)
            saveFilterPrefs()
            reset()
          }}
          sort={sort}
          setSort={v => {
            // Inside a playlist even `latest` stays explicit in the URL, since an absent sort
            // means the playlist's manual order there.
            setSortParam(v === GameSortOption.LatestFirst && view.kind !== 'playlist' ? '' : v)
            saveFilterPrefs()
            reset()
          }}
          mapName={mapName}
          setMapName={v => {
            setMapNameParam(v)
            reset()
          }}
          playerName={playerName}
          setPlayerName={v => {
            setPlayerNameParam(v)
            reset()
          }}
          format={format}
          setFormat={v => {
            setFormatParam(v ?? '')
            // A matchup is tied to a specific format (team size), so any existing value no longer
            // applies once the format changes. Clear it so it doesn't linger in the URL as cruft.
            setMatchupParam('')
            reset()
          }}
          matchup={matchup}
          setMatchup={v => {
            setMatchupParam(v ?? '')
            reset()
          }}
          includeShort={includeShort}
          setIncludeShort={v => {
            setIncludeShortParam(v ? 'true' : '')
            saveFilterPrefs()
            reset()
          }}
          showIncludeShort={view.kind === 'all'}
          showGameType={true}
          gameType={gameType}
          setGameType={v => {
            setGameTypeParam(v === undefined ? '' : String(v))
            saveFilterPrefs()
            reset()
          }}
          spoilerFree={spoilerFree}
          setSpoilerFree={setSpoilerFree}
          startDate={startDate}
          setStartDate={v => {
            setStartDateParam(v)
            reset()
          }}
          endDate={endDate}
          setEndDate={v => {
            setEndDateParam(v)
            reset()
          }}
        />

        <BodyRow>
          <ReplayLibraryRail
            view={view}
            totalIndexed={status?.totalIndexed ?? 0}
            bookmarkedCount={status?.bookmarkedCount ?? 0}
            backfill={railBackfill}
            playlists={playlists}
            onSelectView={v => {
              const pathname = encodeViewPathname(v)
              if (pathname === encodeViewPathname(view)) {
                return
              }
              // A view change is a navigation to a new place: pushing a different pathname mints a
              // new history entry and visit key, and the parent remounts this component keyed on
              // the view pathname, so the outgoing visit's entry window/scroll/selection save in
              // unmount cleanups and the new visit starts clean (which is why there's no `reset()`
              // here). The current filters ride along in the search string.
              push(pathname + window.location.search)
            }}
          />

          <ListColumn>
            <InfiniteScrollList
              nextLoadingEnabled={true}
              isLoadingNext={isLoadingNext}
              hasNextData={hasNextData}
              refreshToken={observerToken}
              onLoadNextData={onLoadNextData}>
              {listContent}
            </InfiniteScrollList>
          </ListColumn>

          {showInspector ? (
            <ReplayInspector
              entry={focusedEntry}
              alignWithFirstRow={!useFlatList}
              playlists={playlists}
              changeToken={changeToken}
              inPlaylistView={view.kind === 'playlist'}
              canReorder={canReorder}
              canMoveUp={canMoveUp}
              canMoveDown={canMoveDown}
              onWatch={watchEntry}
              onReveal={revealEntry}
              onToggleBookmark={toggleBookmark}
              onAddToPlaylist={addToPlaylist}
              onRemoveFromPlaylist={() => {
                if (focusedEntry) removeFromCurrentPlaylist(focusedEntry)
              }}
              onMoveToRecycleBin={trashEntry}
              onMoveUp={() => moveFocusedBy(-1)}
              onMoveDown={() => moveFocusedBy(1)}
            />
          ) : null}
        </BodyRow>

        <Popover {...contextMenuPopoverProps}>
          {focusedEntry ? (
            <MenuList dense={true}>
              <MenuItem
                icon={<MaterialIcon icon='play_arrow' />}
                text={t('replays.library.watchReplay', 'Watch replay')}
                onClick={() => {
                  contextMenuPopoverProps.onDismiss()
                  watchEntry(focusedEntry)
                }}
              />
              <MenuItem
                icon={
                  <MaterialIcon icon='bookmark' filled={focusedEntry.bookmarkedAt !== undefined} />
                }
                text={
                  focusedEntry.bookmarkedAt !== undefined
                    ? t('replays.library.removeBookmark', 'Remove bookmark')
                    : t('replays.library.bookmark', 'Bookmark')
                }
                onClick={() => {
                  contextMenuPopoverProps.onDismiss()
                  toggleBookmark(focusedEntry)
                }}
              />
              {getReplayActionMenuItems({
                entry: focusedEntry,
                inPlaylistView: view.kind === 'playlist',
                closeMenu: contextMenuPopoverProps.onDismiss,
                onOpenAddToPlaylist: openAddToPlaylistMenu,
                onRemoveFromPlaylist: () => removeFromCurrentPlaylist(focusedEntry),
                onReveal: revealEntry,
                onMoveToRecycleBin: trashEntry,
                t,
              })}
            </MenuList>
          ) : null}
        </Popover>
        <Popover
          open={addToPlaylistMenuOpen}
          onDismiss={closeAddToPlaylistMenu}
          anchorX={contextMenuPopoverProps.anchorX}
          anchorY={contextMenuPopoverProps.anchorY}
          originX={contextMenuPopoverProps.originX}
          originY={contextMenuPopoverProps.originY}>
          {focusedEntry ? (
            <MenuList dense={true}>
              {getAddToPlaylistMenuItems({
                entry: focusedEntry,
                playlists,
                closeMenu: closeAddToPlaylistMenu,
                onAddToPlaylist: addToPlaylist,
                t,
                dispatch,
              })}
            </MenuList>
          ) : null}
        </Popover>
      </PageColumn>
    </CenteredContentContainer>
  )
}
