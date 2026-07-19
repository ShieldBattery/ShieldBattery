import { debounce } from 'lodash-es'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GroupedVirtuoso, GroupedVirtuosoHandle, Virtuoso, VirtuosoHandle } from 'react-virtuoso'
import styled, { keyframes } from 'styled-components'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
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
import { DayHeader, formatDayHeaderLabel, getDayBoundaries } from '../games/day-header'
import { GameFilterBar } from '../games/game-filter-bar'
import {
  GameDate,
  GameListEntryLayout,
  MapNoImageContainer,
  ThumbnailContainer,
  WatchReplayOverlay,
} from '../games/game-list-entry'
import { PlayerTeamsDisplay } from '../games/player-teams-display'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { ButtonStateStyleProps, IconButton, TextButton, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useRefreshToken } from '../network/refresh-token'
import { LoadingDotsArea } from '../progress/dots'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  bodyLarge,
  bodyMedium,
  labelMedium,
  singleLine,
  titleLarge,
  titleSmall,
} from '../styles/typography'
import { startReplay } from './action-creators'
import { useSbGameMap } from './replay-hooks'
import { ReplayInspector } from './replay-inspector'
import {
  encodeView,
  getReplayDisplayTeams,
  groupReplaysByDay,
  isManualPlaylistOrder,
  LibraryView,
  parseView,
  playersToDisplayTeams,
} from './replay-library-helpers'
import { ReplayLibraryRail } from './replay-library-rail'

const ipcRenderer = new TypedIpcRenderer()

const ENTER = 'Enter'
const ENTER_NUMPAD = 'NumpadEnter'

/** Number of replay entries fetched per infinite-scroll chunk. */
const LOAD_CHUNK_SIZE = 100

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

function parseMatchup(value: string): EncodedMatchupString | undefined {
  return value ? makeEncodedMatchupString(value) : undefined
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

/**
 * Assembles the query filters (everything but paging) from the current view and filter/sort
 * values. `sort` is `undefined` in a playlist's manual order, which the query treats as "use the
 * playlist's arrangement".
 */
function buildFilters(
  view: LibraryView,
  sort: GameSortOption | undefined,
  mapName: string,
  playerName: string,
  gameType: number | 'others' | undefined,
  duration: GameDurationFilter,
  format: GameFormat | undefined,
  matchup: EncodedMatchupString | undefined,
): ReplayLibraryFilters {
  const filters: ReplayLibraryFilters = {}
  if (view.kind === 'starred') {
    filters.starred = true
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
  display: flex;
  flex-direction: row;
  gap: 24px;
`

const ListColumn = styled.div`
  flex-grow: 1;
  min-width: 0;
`

const CountLine = styled.div`
  ${labelMedium};
  align-self: flex-end;
  padding: 0 6px;
  color: var(--theme-on-surface-variant);
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
  padding: 0 6px;
`

const BackfillLabel = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
  font-variant-numeric: tabular-nums;
`

/**
 * A slim, persistent progress indicator shown above the list while the index backfills: an
 * indeterminate bar while the folder is being scanned (total unknown), then a determinate bar with a
 * running count as replays are parsed. It stays put while the list fills in beneath it, rather than
 * occupying the list area and being swapped out once the first rows arrive.
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

const ReplayRowContainer = styled.div<ButtonStateStyleProps & { $selected: boolean }>`
  position: relative;
  width: 100%;

  border-radius: 8px;
  contain: content;
  cursor: pointer;

  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-on-surface) r g b / 0.1)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--theme-on-surface) r g b / 0.12)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }
`

const PlaceholderIcon = styled(MaterialIcon)`
  opacity: 0.5;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

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

const LeadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const RowStarIcon = styledWithAttrs(MaterialIcon, { icon: 'star', size: 16 })`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const StarOverlayButton = styled(IconButton)<{ $starred: boolean }>`
  color: ${props => (props.$starred ? 'var(--theme-amber)' : 'var(--theme-on-surface-variant)')};
`

interface ReplayListEntryProps {
  entry: ReplayLibraryEntry
  selected: boolean
  computerLabel: string
  watchTitle: string
  starTitle: string
  unstarTitle: string
  onSelect: (id: number) => void
  onWatch: (entry: ReplayLibraryEntry) => void
  onToggleStar: (entry: ReplayLibraryEntry) => void
}

function ReplayListEntry({
  entry,
  selected,
  computerLabel,
  watchTitle,
  starTitle,
  unstarTitle,
  onSelect,
  onWatch,
  onToggleStar,
}: ReplayListEntryProps) {
  const { t } = useTranslation()
  const map = useSbGameMap(entry.parseError ? undefined : entry.sbGameId)
  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => onSelect(entry.id),
    onDoubleClick: () => onWatch(entry),
  })

  const starred = entry.starredAt !== undefined

  const dateElem = entry.parseError ? (
    <GameDate>—</GameDate>
  ) : (
    <Tooltip text={longTimestamp.format(entry.gameTime)} position='right'>
      <GameDate>{narrowDuration.format(entry.gameTime)}</GameDate>
    </Tooltip>
  )
  const leading = starred ? (
    <LeadingRow>
      {dateElem}
      <RowStarIcon />
    </LeadingRow>
  ) : (
    dateElem
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

  const thumbnail = (
    <ThumbnailContainer>
      {map ? (
        <StyledMapThumbnail
          key={map.hash}
          mapId={map.id}
          size={64}
          forceAspectRatio={1}
          hasMapPreviewAction={false}
          hasFavoriteAction={false}
        />
      ) : (
        <MapNoImageContainer>
          <PlaceholderIcon icon={entry.parseError ? 'error' : 'map'} size={36} />
        </MapNoImageContainer>
      )}
      <WatchReplayOverlay>
        <Tooltip text={watchTitle} position='top'>
          <IconButton
            styledAs='div'
            icon={<MaterialIcon icon='play_circle' />}
            onClick={event => {
              event.stopPropagation()
              onSelect(entry.id)
              onWatch(entry)
            }}
          />
        </Tooltip>
        <Tooltip text={starred ? unstarTitle : starTitle} position='top'>
          <StarOverlayButton
            styledAs='div'
            $starred={starred}
            icon={<MaterialIcon icon='star' filled={starred} />}
            onClick={event => {
              event.stopPropagation()
              onToggleStar(entry)
            }}
          />
        </Tooltip>
      </WatchReplayOverlay>
    </ThumbnailContainer>
  )

  return (
    <ReplayRowContainer {...buttonProps} $selected={selected}>
      <GameListEntryLayout
        leading={leading}
        players={players}
        duration={
          entry.parseError ? '—' : getGameDurationString((entry.durationFrames * 1000) / 24)
        }
        mapName={entry.parseError ? '—' : filterColorCodes(entry.mapName)}
        gameTypeLabel={entry.parseError ? '' : replayGameTypeToLabel(entry.gameType, t)}
        thumbnail={thumbnail}
      />
      <Ripple ref={rippleRef} />
    </ReplayRowContainer>
  )
}

// ---- Main component --------------------------------------------------------------------------

export function ReplayLibrary() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [entries, setEntries] = useState<ReadonlyArray<ReplayLibraryEntry>>()
  const [total, setTotal] = useState<number>()
  const [isLoadingNext, setIsLoadingNext] = useState(false)
  const [status, setStatus] = useState<ReplayLibraryStatus>()
  const [backfill, setBackfill] = useState<ReplayBackfillProgress>()
  // Set when the status query rejects, which in practice means the main-process replay library
  // service failed to start (e.g. the SQLite module couldn't load) and none of its IPC handlers are
  // registered — so every query would hang. We surface that instead of spinning forever.
  const [unavailable, setUnavailable] = useState(false)
  const [playlists, setPlaylists] = useState<ReadonlyArray<ReplayPlaylist>>([])
  // Bumped on every index change so entry-scoped fetches (e.g. the inspector's playlist
  // membership) know to refresh.
  const [changeToken, setChangeToken] = useState(0)
  const [observerToken, restartObserver] = useRefreshToken()

  const [focusedId, setFocusedId] = useState<number>()
  const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null)
  const groupedRef = useRef<GroupedVirtuosoHandle>(null)
  const flatRef = useRef<VirtuosoHandle>(null)

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
  const [viewParam, setViewParam] = useLocationSearchParam('view')

  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam)
  const gameType = parseModeFilter(gameTypeParam)
  const view = parseView(viewParam)

  const computerLabel = t('game.playerName.computer', 'Computer')
  const watchTitle = t('replays.library.watchReplay', 'Watch replay')
  const starTitle = t('replays.library.star', 'Star')
  const unstarTitle = t('replays.library.unstar', 'Unstar')

  // The view is navigation rather than a filter: it isn't included here, and clearing filters
  // leaves it alone.
  const hasActiveFilters =
    duration !== GameDurationFilter.All ||
    !!mapName ||
    !!playerName ||
    !!format ||
    !!matchup ||
    gameType !== undefined

  const isDurationSort =
    sort === GameSortOption.ShortestFirst || sort === GameSortOption.LongestFirst
  const manualOrder = isManualPlaylistOrder(view, sortParam)
  // A playlist's manual order has no meaningful day boundaries, so it renders flat like the
  // duration sorts do.
  const useFlatList = isDurationSort || manualOrder
  const effectiveSort = manualOrder ? undefined : sort

  const reset = () => {
    queryEpochRef.current += 1
    setEntries(undefined)
    setTotal(undefined)
    setIsLoadingNext(false)
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
        ...buildFilters(
          view,
          effectiveSort,
          mapName,
          playerName,
          gameType,
          duration,
          format,
          matchup,
        ),
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
  // longer exists (deleted, or a stale URL), we fall back to the whole library.
  const fetchPlaylists = useEffectEvent(() => {
    ipcRenderer
      .invoke('replayLibraryListPlaylists')
      ?.then(result => {
        if (!result) return
        setPlaylists(result)
        if (view.kind === 'playlist' && !result.some(p => p.id === view.id)) {
          setViewParam('')
          reset()
        }
      })
      .catch(swallowNonBuiltins)
  })

  // Listen for index change + backfill events only while mounted.
  useEffect(() => {
    fetchStatus()
    fetchPlaylists()

    const handleChanged = debounce(() => {
      refreshLoadedWindow()
      fetchStatus()
      fetchPlaylists()
      setChangeToken(token => token + 1)
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
  }, [])

  const loadedEntries = entries ?? []
  const focusedEntry = loadedEntries.find(e => e.id === focusedId) ?? loadedEntries[0]
  const focusedIndex = focusedEntry ? loadedEntries.findIndex(e => e.id === focusedEntry.id) : -1

  const watchEntry = (entry: ReplayLibraryEntry) => {
    dispatch(startReplay({ path: entry.path, name: entry.fileName }))
  }
  const revealEntry = (entry: ReplayLibraryEntry) => {
    ipcRenderer.invoke('pathsShowItemInFolder', entry.path)?.catch(swallowNonBuiltins)
  }

  const toggleStar = (entry: ReplayLibraryEntry) => {
    const starred = entry.starredAt === undefined
    // Update optimistically; the resulting index-changed event will confirm (or correct) shortly.
    setEntries(prev =>
      prev?.map(e =>
        e.id === entry.id ? { ...e, starredAt: starred ? Date.now() : undefined } : e,
      ),
    )
    setStatus(prev =>
      prev ? { ...prev, starredCount: Math.max(0, prev.starredCount + (starred ? 1 : -1)) } : prev,
    )
    ipcRenderer.invoke('replayLibrarySetStarred', entry.id, starred)?.catch(swallowNonBuiltins)
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

  // Only meaningful in a playlist's manual order, where the loaded index (contiguous from offset
  // 0) matches the playlist's manual index.
  const moveFocusedBy = (delta: number) => {
    if (view.kind !== 'playlist' || !manualOrder || !focusedEntry || focusedIndex < 0) return
    const toIndex = focusedIndex + delta
    if (toIndex < 0 || toIndex >= (total ?? loadedEntries.length)) return
    ipcRenderer
      .invoke('replayLibraryMovePlaylistEntry', view.id, focusedEntry.id, toIndex)
      ?.catch(swallowNonBuiltins)
  }

  const canMoveUp = manualOrder && focusedIndex > 0
  const canMoveDown =
    manualOrder && focusedIndex >= 0 && focusedIndex < (total ?? loadedEntries.length) - 1

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
        ...buildFilters(
          view,
          effectiveSort,
          mapName,
          playerName,
          gameType,
          duration,
          format,
          matchup,
        ),
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
    reset()
    // `sort` is a view option (not a filter), so it's intentionally left untouched.
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
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
        watchTitle={watchTitle}
        starTitle={starTitle}
        unstarTitle={unstarTitle}
        onSelect={setFocusedId}
        onWatch={watchEntry}
        onToggleStar={toggleStar}
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
    } else if (view.kind === 'starred') {
      listContent = (
        <CenteredState>
          <EmptyStateTitle>
            {t('replays.library.starredEmpty', 'No starred replays')}
          </EmptyStateTitle>
          <div>
            {t('replays.library.starredEmptyBody', 'Star replays to keep them handy here.')}
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
          {status?.watchedFolder ? <EmptyStatePath>{status.watchedFolder}</EmptyStatePath> : null}
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
        totalCount={loadedEntries.length}
        itemContent={renderRow}
      />
    ) : (
      <GroupedVirtuoso
        key='grouped'
        ref={groupedRef}
        customScrollParent={scrollParent}
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

  // The unfiltered size of the current view, so "x of y" is measured against what's actually
  // being browsed rather than the whole index.
  let viewTotal: number | undefined
  switch (view.kind) {
    case 'all':
      viewTotal = status?.totalIndexed
      break
    case 'starred':
      viewTotal = status?.starredCount
      break
    case 'playlist':
      viewTotal = playlists.find(p => p.id === view.id)?.count
      break
    default:
      viewTotal = view satisfies never
  }

  let countLine: React.ReactNode = null
  if (backfill && (backfill.phase === 'indexing' || loadedEntries.length === 0)) {
    // A slim progress bar rides above the list for the whole backfill, staying put while rows fill
    // in beneath it. The scanning phase (total unknown) is only surfaced while the list is still
    // empty — an already-populated library re-scans on every startup with no work to do, and a
    // flashing "Scanning…" there would just be noise.
    countLine = <BackfillProgressBar backfill={backfill} />
  } else if (entries !== undefined) {
    countLine = (
      <CountLine>
        {hasActiveFilters
          ? t('replays.library.filteredCount', {
              defaultValue: '{{shown}} of {{total}} replays',
              shown: total ?? loadedEntries.length,
              total: viewTotal ?? loadedEntries.length,
            })
          : t('replays.library.replayCount', {
              defaultValue: '{{count}} replays',
              count: viewTotal ?? total ?? loadedEntries.length,
            })}
      </CountLine>
    )
  }

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
    <CenteredContentContainer ref={setScrollParent} $targetWidth={1280}>
      <PageColumn>
        <GameFilterBar
          showRankedCustom={false}
          duration={duration}
          setDuration={v => {
            setDurationParam(v === GameDurationFilter.All ? '' : v)
            reset()
          }}
          sort={sort}
          setSort={v => {
            // Inside a playlist even `latest` stays explicit in the URL, since an absent sort
            // means the playlist's manual order there.
            setSortParam(v === GameSortOption.LatestFirst && view.kind !== 'playlist' ? '' : v)
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
            reset()
          }}
          matchup={matchup}
          setMatchup={v => {
            setMatchupParam(v ?? '')
            reset()
          }}
          showGameType={true}
          gameType={gameType}
          setGameType={v => {
            setGameTypeParam(v === undefined ? '' : String(v))
            reset()
          }}
        />

        {countLine}

        <BodyRow>
          <ReplayLibraryRail
            view={view}
            totalIndexed={status?.totalIndexed ?? 0}
            starredCount={status?.starredCount ?? 0}
            playlists={playlists}
            onSelectView={v => {
              const encoded = encodeView(v)
              if (encoded === viewParam) return
              setViewParam(encoded)
              reset()
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

          <ReplayInspector
            entry={focusedEntry}
            alignWithFirstRow={!useFlatList}
            playlists={playlists}
            changeToken={changeToken}
            inPlaylistView={view.kind === 'playlist'}
            canReorder={manualOrder}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onWatch={watchEntry}
            onReveal={revealEntry}
            onToggleStar={toggleStar}
            onAddToPlaylist={addToPlaylist}
            onRemoveFromPlaylist={() => {
              if (focusedEntry) removeFromCurrentPlaylist(focusedEntry)
            }}
            onMoveUp={() => moveFocusedBy(-1)}
            onMoveDown={() => moveFocusedBy(1)}
          />
        </BodyRow>
      </PageColumn>
    </CenteredContentContainer>
  )
}
