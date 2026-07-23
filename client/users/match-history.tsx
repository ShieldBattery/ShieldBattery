import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_GAME_FORMATS,
  decodeMatchup,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { SbUserId } from '../../common/users/sb-user-id'
import { useContextMenu } from '../dom/use-context-menu'
import { navigateToGameResults } from '../games/action-creators'
import { renderGamesWithDayHeaders, resolveDateRangeMs } from '../games/day-header'
import { GameContextMenuContent } from '../games/game-context-menu'
import { GameFilterBar } from '../games/game-filter-bar'
import { GameListEntry } from '../games/game-list-entry'
import { GameRecordSidePanel } from '../games/game-record-side-panel'
import { GameListSearchPage, useGameListSearch } from '../games/use-game-list-search'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { Popover } from '../material/popover'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useAppDispatch } from '../redux-hooks'
import { bodyLarge } from '../styles/typography'
import { getMatchHistory } from './action-creators'

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const MatchHistoryContainer = styled.div`
  width: 100%;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
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

function parseMatchup(
  value: string,
  format: GameFormat | undefined,
): EncodedMatchupString | undefined {
  if (!value || !format) {
    return undefined
  }
  // Only keep the matchup if it actually decodes for the current format. This mirrors what the
  // server does and means a hand-edited URL (e.g. `?matchup=foo`) gets ignored rather than sent
  // along to fail server-side validation and show the user a generic error screen.
  const encoded = makeEncodedMatchupString(value)
  return decodeMatchup(format, encoded) ? encoded : undefined
}

/** A date-based sort groups games by calendar day; the duration sorts render as a flat list. */
function isDateSort(sort: GameSortOption): boolean {
  return sort === GameSortOption.LatestFirst || sort === GameSortOption.OldestFirst
}

export function ConnectedMatchHistory({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [rankedParam, setRankedParam] = useLocationSearchParam('ranked')
  const [customParam, setCustomParam] = useLocationSearchParam('custom')
  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [startDateParam, setStartDateParam] = useLocationSearchParam('startDate')
  const [endDateParam, setEndDateParam] = useLocationSearchParam('endDate')

  const ranked = rankedParam === 'true'
  const custom = customParam === 'true'
  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam, format)

  const [selectedId, setSelectedId] = useState<string>()
  const rowElemsRef = useRef(new Map<string, HTMLDivElement>())

  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  const loadPage = (offset: number, signal: AbortSignal): Promise<GameListSearchPage> => {
    const { startMs, endMs } = resolveDateRangeMs(startDateParam, endDateParam)
    return new Promise((resolve, reject) => {
      dispatch(
        getMatchHistory(
          userId,
          {
            ranked: ranked || undefined,
            custom: custom || undefined,
            duration: duration === GameDurationFilter.All ? undefined : duration,
            sort: sort === GameSortOption.LatestFirst ? undefined : sort,
            mapName: mapName || undefined,
            playerName: playerName || undefined,
            format,
            matchup,
            startDate: startMs,
            endDate: endMs,
            offset,
          },
          {
            signal,
            onSuccess: result => {
              resolve({ gameIds: result.games.map(g => g.id), hasMoreGames: result.hasMoreGames })
            },
            onError: err => reject(err),
          },
        ),
      )
    })
  }

  const { games, hasMoreGames, isLoadingMore, searchError, refreshToken, reset, onLoadMore } =
    useGameListSearch(loadPage)

  const selectedGame = games.find(g => g.id === selectedId) ?? games[0]
  const selectedIndex = selectedGame ? games.findIndex(g => g.id === selectedGame.id) : -1
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
      // Every key here acts on the match history list, but this page's key listener boundary is
      // shared with other UI (e.g. the social sidebar's chat input, whose keydowns bubble to the
      // document). While a text-entry element has focus, the keystroke belongs to it instead.
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
      ranked={ranked}
      setRanked={v => {
        setRankedParam(v ? 'true' : '')
        reset()
      }}
      custom={custom}
      setCustom={v => {
        setCustomParam(v ? 'true' : '')
        reset()
      }}
      duration={duration}
      setDuration={v => {
        setDurationParam(v === GameDurationFilter.All ? '' : v)
        reset()
      }}
      sort={sort}
      setSort={v => {
        setSortParam(v === GameSortOption.LatestFirst ? '' : v)
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
  // its own loading indicator can show, matching how this page behaved before it was rewired onto
  // `useGameListSearch`.
  const confirmedEmpty = !hasMoreGames && games.length === 0

  let listBody: React.ReactNode
  if (searchError) {
    listBody = (
      <ErrorText>
        {t('user.matchHistory.retrievingError', 'There was an error retrieving the match history.')}
      </ErrorText>
    )
  } else if (confirmedEmpty) {
    listBody = <NoResults>{t('user.matchHistory.noMatchingGames', 'No matching games.')}</NoResults>
  } else {
    const gameItems = renderGamesWithDayHeaders(games, sort, t, game => (
      <GameListEntry
        key={game.id}
        game={game}
        showResult={true}
        forUserId={userId}
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
    <MatchHistoryContainer>
      {filterBar}

      <BodyRow>
        <ListColumn>{listBody}</ListColumn>

        {showPanel ? (
          <GameRecordSidePanel
            game={selectedGame}
            forUserId={userId}
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
          />
        </Popover>
      ) : null}
    </MatchHistoryContainer>
  )
}
