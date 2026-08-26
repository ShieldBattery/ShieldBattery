import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  GameSourceFilter,
} from '../../common/games/game-filters'
import { SbUserId } from '../../common/users/sb-user-id'
import { useContextMenu } from '../dom/use-context-menu'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { Popover, usePopoverController } from '../material/popover'
import { useHistoryEntryKey, useLocationSearchParam } from '../navigation/router-hooks'
import { createViewStateStore } from '../navigation/view-state-store'
import { useUserLocalStorageValue } from '../react/state-hooks'
import { useAppSelector } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { navigateToGameResults } from './action-creators'
import { renderGamesWithDayHeaders, resolveDateRangeMs } from './day-header'
import { GameContextMenuContent } from './game-context-menu'
import { GameFilterBar } from './game-filter-bar'
import {
  isDateSort,
  parseDuration,
  parseFormat,
  parseMatchup,
  parseSort,
  parseSource,
} from './game-filter-url'
import { GameListEntry } from './game-list-entry'
import { GameRecordSidePanel } from './game-record-side-panel'
import { SaveReplayMenuContent } from './save-replay-menu'
import { GameListSearchPage, useGameListSearch } from './use-game-list-search'
import { FilterMemorySurface, useRememberedFilters } from './use-remembered-filters'

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const BodyRow = styled.div`
  display: flex;
  flex-direction: row;
  gap: 24px;
`

const ListColumn = styled.div`
  flex-grow: 1;
  min-width: 0;

  /*
    Named container so row cells (see game-list-entry.tsx) can adapt to the actual width rows get —
    which depends on the window size *and* whether the side detail panel is showing — rather than
    the viewport or the whole BodyRow (which also includes the panel's width).
  */
  container: game-list-rows / inline-size;
`

const SELECTION_MEMORY_MAX_AGE_MS = 30 * 60 * 1000

const selectedIdCache = createViewStateStore<string>('game-list-selection', {
  maxAgeMs: SELECTION_MEMORY_MAX_AGE_MS,
})

/** The normalized, ready-to-request filter values a game list view is currently showing. */
export interface GameListFilters {
  ranked?: boolean
  custom?: boolean
  source?: GameSourceFilter
  duration?: GameDurationFilter
  sort?: GameSortOption
  mapName?: string
  playerName?: string
  format?: GameFormat
  matchup?: EncodedMatchupString
  /** Inclusive lower bound (unix ms) on the game's start time. */
  startDate?: number
  /** Inclusive upper bound (unix ms) on the game's start time. */
  endDate?: number
  /** When true, includes games shorter than `MIN_GAME_LENGTH_MS` (hidden by default). */
  includeShort?: boolean
}

export interface GameListViewProps {
  /**
   * Loads one page of games for the given filters/offset — implemented per surface (the games
   * page, a user's match history, a league's games) by dispatching the matching request. Resolves
   * with the page's game ids and whether more remain; populating the normalized game/map/user
   * stores is a side effect of that dispatch.
   */
  loadPage: (
    filters: GameListFilters,
    offset: number,
    signal: AbortSignal,
  ) => Promise<GameListSearchPage>
  /**
   * Which surface this is, naming the saved set its mode-like filter preferences (sort, duration,
   * short games, and whichever mode filters it shows) are remembered in across visits.
   */
  surface: Exclude<FilterMemorySurface, 'replays'>
  /** Shows the Ranked/Custom source toggles and reads their URL params (match history only). */
  showRankedCustom?: boolean
  /** Shows the game source (All/Ranked/Custom) filter chip and reads its URL param (games page only). */
  showSourceFilter?: boolean
  /**
   * Shows each row's win/loss result. From `forUserId`'s perspective when given (match history);
   * otherwise from whichever side of the matchup is listed first (games page, league games).
   */
  showResult?: boolean
  /** Whose perspective results and the side panel roster are shown from (match history only). */
  forUserId?: SbUserId
  /** Rendered in place of the list once a load has confirmed there are no matching games. */
  noResultsText: string
  /** Rendered in place of the list when a load fails. */
  errorText: string
}

/**
 * The shared games-list surface: a filter bar over a paginated, selectable list with a detail side
 * panel and per-row context menu, backed by `useGameListSearch`. The games page, match history, and
 * a league's games tab are all thin wrappers that supply a `loadPage` and their own outer layout.
 *
 * Owns the filter state (mirrored to URL search params, with the mode-like ones remembered per
 * surface across visits), the list selection, and the keyboard navigation; callers differ only in
 * where they fetch from and a few presentation flags. Renders as a fragment (filter bar, then the
 * list/panel row) so each surface controls its own container and spacing.
 */
export function GameListView({
  loadPage,
  surface,
  showRankedCustom = false,
  showSourceFilter = false,
  showResult = false,
  forUserId,
  noResultsText,
  errorText,
}: GameListViewProps) {
  const { t } = useTranslation()

  const [rankedParam, setRankedParam] = useLocationSearchParam('ranked')
  const [customParam, setCustomParam] = useLocationSearchParam('custom')
  const [sourceParam, setSourceParam] = useLocationSearchParam('source')
  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [startDateParam, setStartDateParam] = useLocationSearchParam('startDate')
  const [endDateParam, setEndDateParam] = useLocationSearchParam('endDate')
  const [includeShortParam, setIncludeShortParam] = useLocationSearchParam('includeShort')

  // Only the params a surface actually shows are remembered for it, which also keeps a hand-edited
  // param that surface ignores from counting as "the URL specifies the filters".
  const rememberedUrlValues: Record<string, string> = {
    sort: sortParam,
    duration: durationParam,
    includeShort: includeShortParam,
  }
  if (showSourceFilter) {
    rememberedUrlValues.source = sourceParam
  }
  if (showRankedCustom) {
    rememberedUrlValues.ranked = rankedParam
    rememberedUrlValues.custom = customParam
  }
  const { values: filterValues, save: saveFilterPrefs } = useRememberedFilters(
    surface,
    rememberedUrlValues,
  )

  // Ranked/custom only exist on the match-history surface; elsewhere we neither read nor send them,
  // so a hand-edited `?ranked=true` on another surface can't leak into the request.
  const ranked = showRankedCustom && filterValues.ranked === 'true'
  const custom = showRankedCustom && filterValues.custom === 'true'
  // The source filter only exists on the games page; elsewhere we neither read nor send it, so a
  // hand-edited `?source=custom` on another surface can't leak into the request.
  const source = showSourceFilter ? parseSource(filterValues.source) : GameSourceFilter.All
  const duration = parseDuration(filterValues.duration)
  const sort = parseSort(filterValues.sort)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam, format)
  const includeShort = filterValues.includeShort === 'true'

  const entryKey = useHistoryEntryKey()
  // Read once per mount: a lazy initializer runs at most once, so this never re-reads the store on
  // a re-render.
  const [selectedId, setSelectedId] = useState<string | undefined>(() =>
    entryKey !== undefined ? selectedIdCache.get(entryKey) : undefined,
  )
  const rowElemsRef = useRef(new Map<string, HTMLDivElement>())

  // Remembered per-user and shared across the replay library, games page, match history, and league
  // games: hides the game length and (where shown) the match result — both spoilers — from list rows.
  const [spoilerFree, setSpoilerFree] = useUserLocalStorageValue('gamesSpoilerFree', false)

  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()
  const [saveMenuOpen, openSaveMenu, closeSaveMenu] = usePopoverController()

  const loadPageForSearch = (offset: number, signal: AbortSignal): Promise<GameListSearchPage> => {
    const { startMs, endMs } = resolveDateRangeMs(startDateParam, endDateParam)
    return loadPage(
      {
        ranked: ranked || undefined,
        custom: custom || undefined,
        source: source === GameSourceFilter.All ? undefined : source,
        duration: duration === GameDurationFilter.All ? undefined : duration,
        sort: sort === GameSortOption.LatestFirst ? undefined : sort,
        mapName: mapName || undefined,
        playerName: playerName || undefined,
        format,
        matchup,
        startDate: startMs,
        endDate: endMs,
        includeShort: includeShort || undefined,
      },
      offset,
      signal,
    )
  }

  const { games, hasMoreGames, isLoadingMore, searchError, refreshToken, reset, onLoadMore } =
    useGameListSearch(loadPageForSearch)

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Cleanup-time write, matching `useScrollMemory`'s timing: a selection is never un-made (a
    // restored id absent from the current list just falls back to `games[0]` below), so unlike the
    // game-id window there's nothing to delete here.
    return () => {
      if (selectedId !== undefined) {
        selectedIdCache.set(entryKey, selectedId)
      }
    }
  }, [entryKey, selectedId])

  const selectedGame = games.find(g => g.id === selectedId) ?? games[0]
  const selectedIndex = selectedGame ? games.findIndex(g => g.id === selectedGame.id) : -1
  const selectedReplayInfo = useAppSelector(s =>
    selectedGame ? s.games.replayInfoById.get(selectedGame.id) : undefined,
  )
  const sortIsDateBased = isDateSort(sort)

  const selectIndex = (index: number) => {
    if (index < 0 || index >= games.length) return
    const game = games[index]
    setSelectedId(game.id)
    rowElemsRef.current.get(game.id)?.scrollIntoView({ block: 'nearest' })
  }
  const moveSelection = (delta: number) => {
    if (games.length === 0) return
    const base = selectedIndex < 0 ? 0 : selectedIndex
    const next = Math.min(Math.max(base + delta, 0), games.length - 1)
    selectIndex(next)
  }

  useKeyListener({
    onKeyDown: (event: KeyboardEvent) => {
      // Every key here acts on the games list, but this page's key listener boundary is shared with
      // other UI (e.g. the social sidebar's chat input, whose keydowns bubble to the document).
      // While a text-entry element has focus, the keystroke belongs to it instead.
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
          moveSelection(-1)
          return true
        case 'ArrowDown':
          moveSelection(1)
          return true
        case 'PageUp':
          moveSelection(-10)
          return true
        case 'PageDown':
          moveSelection(10)
          return true
        case 'Home':
          selectIndex(0)
          return true
        case 'End':
          selectIndex(games.length - 1)
          return true
        case 'Enter':
        case 'NumpadEnter': {
          const active = document.activeElement
          // If the user is on an interactive control (e.g. a focused button), let it handle Enter.
          if (
            active instanceof HTMLElement &&
            (active.tagName === 'BUTTON' || active.tagName === 'A')
          ) {
            return false
          }
          if (selectedGame) navigateToGameResults(selectedGame.id)
          return true
        }
      }

      return false
    },
  })

  const filterBar = (
    <GameFilterBar
      showRankedCustom={showRankedCustom}
      ranked={ranked}
      setRanked={v => {
        setRankedParam(v ? 'true' : '')
        saveFilterPrefs()
        reset()
      }}
      custom={custom}
      setCustom={v => {
        setCustomParam(v ? 'true' : '')
        saveFilterPrefs()
        reset()
      }}
      showSourceFilter={showSourceFilter}
      source={source}
      setSource={v => {
        setSourceParam(v === GameSourceFilter.All ? '' : v)
        saveFilterPrefs()
        reset()
      }}
      duration={duration}
      setDuration={v => {
        setDurationParam(v === GameDurationFilter.All ? '' : v)
        saveFilterPrefs()
        reset()
      }}
      sort={sort}
      setSort={v => {
        setSortParam(v === GameSortOption.LatestFirst ? '' : v)
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
      spoilerFree={spoilerFree}
      setSpoilerFree={setSpoilerFree}
      startDate={startDateParam}
      setStartDate={v => {
        setStartDateParam(v)
        reset()
      }}
      endDate={endDateParam}
      setEndDate={v => {
        setEndDateParam(v)
        reset()
      }}
    />
  )

  // A page load that's returned at least once with nothing left to fetch is a confirmed empty
  // result; until then (including the very first, still in-flight page) we render the list shell so
  // its own loading indicator can show.
  const confirmedEmpty = !hasMoreGames && games.length === 0

  let listBody: React.ReactNode
  if (searchError) {
    listBody = <ErrorText>{errorText}</ErrorText>
  } else if (confirmedEmpty) {
    listBody = <NoResults>{noResultsText}</NoResults>
  } else {
    const gameItems = renderGamesWithDayHeaders(games, sort, t, game => (
      <GameListEntry
        key={game.id}
        game={game}
        showResult={showResult}
        forUserId={forUserId}
        spoilerFree={spoilerFree}
        selected={game.id === selectedGame?.id}
        onClick={setSelectedId}
        onDoubleClick={gameId => navigateToGameResults(gameId)}
        onContextMenu={(gameId, event) => {
          setSelectedId(gameId)
          onContextMenu(event)
        }}
        ref={el => {
          if (el) {
            rowElemsRef.current.set(game.id, el)
          } else {
            rowElemsRef.current.delete(game.id)
          }
        }}
      />
    ))

    listBody = (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMore}
        hasNextData={hasMoreGames}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMore}>
        {gameItems}
      </InfiniteScrollList>
    )
  }

  // Mirrors the replay library's inspector: dropped entirely once there are confirmed to be no
  // results, rather than showing an empty "select a game" placeholder beside the empty-state message.
  const showPanel = !confirmedEmpty && !searchError

  return (
    <>
      {filterBar}

      <BodyRow>
        <ListColumn>{listBody}</ListColumn>

        {showPanel ? (
          <GameRecordSidePanel
            game={selectedGame}
            forUserId={forUserId}
            alignWithFirstRow={sortIsDateBased}
            onViewResults={gameId => navigateToGameResults(gameId)}
          />
        ) : null}
      </BodyRow>

      {selectedGame ? (
        <Popover {...contextMenuPopoverProps}>
          <GameContextMenuContent
            game={selectedGame}
            onDismiss={contextMenuPopoverProps.onDismiss}
            onOpenSaveMenu={openSaveMenu}
          />
        </Popover>
      ) : null}

      {selectedGame && selectedReplayInfo && IS_ELECTRON ? (
        <Popover
          open={saveMenuOpen}
          onDismiss={closeSaveMenu}
          anchorX={contextMenuPopoverProps.anchorX}
          anchorY={contextMenuPopoverProps.anchorY}
          originX={contextMenuPopoverProps.originX}
          originY={contextMenuPopoverProps.originY}>
          <SaveReplayMenuContent replayInfo={selectedReplayInfo} onDismiss={closeSaveMenu} />
        </Popover>
      ) : null}
    </>
  )
}
