import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { useQuery } from 'urql'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { FragmentType, graphql, useFragment } from '../gql'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { elevationPlus1 } from '../material/shadows'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { ContainerLevel, containerStyles } from '../styles/colors'
import { bodyLarge, singleLine, titleLarge } from '../styles/typography'
import { getGames } from './action-creators'
import { GameFilterBar } from './game-filter-bar'
import { GameListEntry } from './game-list-entry'
import { LiveGameEntry } from './live-game-entry'

const NoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

const ErrorText = styled.div`
  ${bodyLarge};

  color: var(--theme-error);
`

const GamesListContainer = styled.div`
  width: 100%;
  padding-top: 24px;

  display: flex;
  flex-direction: column;
  gap: 16px;
`

const SearchResults = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
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

function parseMatchup(value: string): EncodedMatchupString | undefined {
  return value ? makeEncodedMatchupString(value) : undefined
}

const GamesListQuery = graphql(/* GraphQL */ `
  query GamesPageContent {
    ...LiveGames_FeedFragment
  }
`)

export function GameList() {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [durationParam, setDurationParam] = useLocationSearchParam('duration')
  const [sortParam, setSortParam] = useLocationSearchParam('sort')
  const [mapName, setMapNameParam] = useLocationSearchParam('mapName')
  const [playerName, setPlayerNameParam] = useLocationSearchParam('playerName')
  const [formatParam, setFormatParam] = useLocationSearchParam('format')
  const [matchupParam, setMatchupParam] = useLocationSearchParam('matchup')

  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam)

  const [gameIds, setGameIds] = useState<string[]>()
  const [hasMoreGames, setHasMoreGames] = useState(true)
  const [isLoadingMoreGames, setIsLoadingMoreGames] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>(undefined)
  const [refreshToken, triggerRefresh] = useRefreshToken()

  const games = useAppSelector(s => gameIds?.map(id => s.games.byId.get(id)!)) ?? []

  // TODO(marko): Figure out if we particularly care about the errors when loading this, since we're
  // hiding the live games feed if there are no live games anyway.
  const [{ data }] = useQuery({ query: GamesListQuery, context: { ttl: 10 * 1000 } })

  const reset = () => {
    abortControllerRef.current?.abort()
    setGameIds(undefined)
    setHasMoreGames(true)
    setIsLoadingMoreGames(false)
    setSearchError(undefined)
    triggerRefresh()
  }

  const onLoadMoreGames = () => {
    setIsLoadingMoreGames(true)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      getGames(
        {
          duration: duration === GameDurationFilter.All ? undefined : duration,
          sort: sort === GameSortOption.LatestFirst ? undefined : sort,
          mapName: mapName || undefined,
          playerName: playerName || undefined,
          format,
          matchup: matchup ? makeEncodedMatchupString(matchup) : undefined,
          offset: gameIds?.length ?? 0,
        },
        {
          signal: abortControllerRef.current.signal,
          onSuccess: data => {
            setIsLoadingMoreGames(false)
            setGameIds(prev => (prev ?? []).concat(data.games.map(g => g.id)))
            setHasMoreGames(data.hasMoreGames)
            setSearchError(undefined)
          },
          onError: err => {
            setIsLoadingMoreGames(false)
            setSearchError(err)
          },
        },
      ),
    )
  }

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

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
    />
  )

  if (searchError) {
    return (
      <GamesListContainer>
        {filterBar}
        <ErrorText>
          {t('games.list.retrievingError', 'There was an error retrieving the games.')}
        </ErrorText>
      </GamesListContainer>
    )
  } else if (gameIds?.length === 0) {
    return (
      <GamesListContainer>
        <LiveGamesFeed query={data} />
        {filterBar}
        <NoResults>{t('games.list.noMatchingGames', 'No matching games.')}</NoResults>
      </GamesListContainer>
    )
  } else {
    const gameItems = games.map(game => (
      <GameListEntry key={game.id} game={game} showResult={false} />
    ))

    return (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreGames}
        hasNextData={hasMoreGames}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreGames}>
        <GamesListContainer>
          <LiveGamesFeed query={data} />
          {filterBar}
          <SearchResults>{gameItems}</SearchResults>
        </GamesListContainer>
      </InfiniteScrollList>
    )
  }
}

const LiveGames_FeedFragment = graphql(/* GraphQL */ `
  fragment LiveGames_FeedFragment on Query {
    liveGames {
      id
      ...LiveGames_FeedEntryFragment
    }
  }
`)

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
