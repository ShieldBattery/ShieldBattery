import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { useQuery } from 'urql'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { GameRecordJson } from '../../common/games/games'
import { useContextMenu } from '../dom/use-context-menu'
import { FragmentType, graphql, useFragment } from '../gql'
import { useKeyListener } from '../keyboard/key-listener'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { Divider } from '../material/menu/divider'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover } from '../material/popover'
import { elevationPlus1 } from '../material/shadows'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useAppDispatch } from '../redux-hooks'
import { CenteredContentContainer } from '../styles/centered-container'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyLarge, singleLine, titleLarge } from '../styles/typography'
import { getGames, navigateToGameResults } from './action-creators'
import { renderGamesWithDayHeaders, resolveDateRangeMs } from './day-header'
import { GameFilterBar } from './game-filter-bar'
import { GameListEntry } from './game-list-entry'
import { GameRecordSidePanel } from './game-record-side-panel'
import { LiveGameEntry, LiveGames_FeedFragment } from './live-game-entry'
import { GameListSearchPage, useGameListSearch } from './use-game-list-search'
import { useGameReplayActions } from './use-game-replay-actions'

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

/** A date-based sort groups games by calendar day; the duration sorts render as a flat list. */
function isDateSort(sort: GameSortOption): boolean {
  return sort === GameSortOption.LatestFirst || sort === GameSortOption.OldestFirst
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

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const Title = styled.div`
  ${titleLarge};
  ${singleLine};
`

const GameEntriesRoot = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  padding-top: 8px;
`

const StyledLiveGameEntry = styled(LiveGameEntry)`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};
`

const GamesListQuery = graphql(/* GraphQL */ `
  query GamesPageContent {
    ...LiveGames_FeedFragment
  }
`)

function LiveGamesFeed({ query }: { query?: FragmentType<typeof LiveGames_FeedFragment> }) {
  const { t } = useTranslation()
  const { liveGames } = useFragment(LiveGames_FeedFragment, query) ?? { liveGames: [] }

  return liveGames.length > 0 ? (
    <div>
      <Title>{t('games.liveGames.title', 'Live games')}</Title>
      <GameEntriesRoot>
        {liveGames.map(liveGame => (
          <StyledLiveGameEntry key={liveGame.id} query={liveGame} />
        ))}
      </GameEntriesRoot>
    </div>
  ) : null
}

// ---- Context menu -----------------------------------------------------------------------------

/**
 * Split out from the page so `useGameReplayActions` (which subscribes to this game's replay info)
 * only runs while the menu is actually open, rather than for every row on every render.
 */
function GameListContextMenuContent({
  game,
  onDismiss,
}: {
  game: ReadonlyDeep<GameRecordJson>
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const { replayInfo, onWatchReplay, onSaveReplay } = useGameReplayActions(game)

  return (
    <MenuList dense={true}>
      <MenuItem
        text={t('games.sidePanel.viewFullResults', 'View full results')}
        onClick={() => {
          onDismiss()
          navigateToGameResults(game.id)
        }}
      />
      {IS_ELECTRON && replayInfo ? (
        <>
          <Divider $dense={true} />
          <MenuItem
            text={t('gameDetails.buttonWatchReplay', 'Watch replay')}
            onClick={() => {
              onDismiss()
              onWatchReplay()
            }}
          />
          <MenuItem
            text={t('gameDetails.buttonSaveReplay', 'Save replay')}
            onClick={() => {
              onDismiss()
              onSaveReplay()
            }}
          />
        </>
      ) : null}
    </MenuList>
  )
}

// ---- Main component --------------------------------------------------------------------------

export function GameList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')
  const [startDateParam, setStartDateParam] = useLocationSearchParam('startDate')
  const [endDateParam, setEndDateParam] = useLocationSearchParam('endDate')

  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam)

  const [selectedId, setSelectedId] = useState<string>()
  const rowElemsRef = useRef(new Map<string, HTMLDivElement>())

  const { onContextMenu, contextMenuPopoverProps } = useContextMenu()

  // TODO(marko): Figure out if we particularly care about the errors when loading this, since we're
  // hiding the live games feed if there are no live games anyway.
  // TODO(marko): This is a one-shot query (nothing re-executes it), so finished games linger in the
  // "Live games" section and can briefly show up in both sections. Matches the home feed for now,
  // but if this page is meant to feel live we should re-run it periodically.
  const [{ data }] = useQuery({ query: GamesListQuery, context: { ttl: 10 * 1000 } })

  const loadPage = (offset: number, signal: AbortSignal): Promise<GameListSearchPage> => {
    const { startMs, endMs } = resolveDateRangeMs(startDateParam, endDateParam)
    return new Promise((resolve, reject) => {
      dispatch(
        getGames(
          {
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
      // Every key here acts on the game list, but this page's key listener boundary is shared with
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
      showRankedCustom={false}
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
        {t('games.list.retrievingError', 'There was an error retrieving the games.')}
      </ErrorText>
    )
  } else if (confirmedEmpty) {
    listBody = <NoResults>{t('games.list.noMatchingGames', 'No matching games.')}</NoResults>
  } else {
    const gameItems = renderGamesWithDayHeaders(games, sort, t, game => (
      <GameListEntry
        key={game.id}
        game={game}
        showResult={false}
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
    <CenteredContentContainer $fullWidth={true} data-content-fullbleed=''>
      <PageColumn>
        <LiveGamesFeed query={data} />

        {filterBar}

        <BodyRow>
          <ListColumn>{listBody}</ListColumn>

          {showPanel ? (
            <GameRecordSidePanel
              game={selectedGame}
              alignWithFirstRow={sortIsDateBased}
              onViewResults={gameId => navigateToGameResults(gameId)}
            />
          ) : null}
        </BodyRow>
      </PageColumn>

      {selectedGame ? (
        <Popover {...contextMenuPopoverProps}>
          <GameListContextMenuContent
            game={selectedGame}
            onDismiss={contextMenuPopoverProps.onDismiss}
          />
        </Popover>
      ) : null}
    </CenteredContentContainer>
  )
}
