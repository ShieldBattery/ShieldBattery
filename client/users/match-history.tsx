import { useEffect, useRef, useState } from 'react'
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
import { GameFilterBar } from '../games/game-filter-bar'
import { GameListEntry } from '../games/game-list-entry'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
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

  const ranked = rankedParam === 'true'
  const custom = customParam === 'true'
  const duration = parseDuration(durationParam)
  const sort = parseSort(sortParam)
  const format = parseFormat(formatParam)
  const matchup = parseMatchup(matchupParam, format)

  const [gameIds, setGameIds] = useState<string[]>()
  const [hasMoreGames, setHasMoreGames] = useState(true)
  const [isLoadingMoreGames, setIsLoadingMoreGames] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>(undefined)
  const [refreshToken, triggerRefresh] = useRefreshToken()

  // NOTE(2Pac): We select the (stable) map and derive the list in render rather than mapping inside
  // the selector, which would return a fresh array on every store update and re-render the whole
  // list on any Redux action. react-compiler memoizes the derivation below.
  const gamesById = useAppSelector(s => s.games.byId)
  const games = gameIds?.map(id => gamesById.get(id)!) ?? []

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
          offset: gameIds?.length ?? 0,
        },
        {
          signal: abortControllerRef.current.signal,
          onSuccess: data => {
            setIsLoadingMoreGames(false)
            // A newly-completed game by this user shifts the window between page loads, so a later
            // page can re-serve rows from an earlier one. Dedupe on concat to avoid duplicate React
            // keys / repeated rows.
            setGameIds(prev => {
              const existingIds = new Set(prev ?? [])
              return (prev ?? []).concat(
                data.games.map(g => g.id).filter(id => !existingIds.has(id)),
              )
            })
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
    />
  )

  if (searchError) {
    return (
      <MatchHistoryContainer>
        {filterBar}
        <ErrorText>
          {t(
            'user.matchHistory.retrievingError',
            'There was an error retrieving the match history.',
          )}
        </ErrorText>
      </MatchHistoryContainer>
    )
  } else if (gameIds?.length === 0) {
    return (
      <MatchHistoryContainer>
        {filterBar}
        <NoResults>{t('user.matchHistory.noMatchingGames', 'No matching games.')}</NoResults>
      </MatchHistoryContainer>
    )
  } else {
    const gameItems = games.map(game => (
      <GameListEntry key={game.id} game={game} showResult={true} forUserId={userId} />
    ))

    return (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreGames}
        hasNextData={hasMoreGames}
        refreshToken={refreshToken}
        onLoadNextData={onLoadMoreGames}>
        <MatchHistoryContainer>
          {filterBar}
          <SearchResults>{gameItems}</SearchResults>
        </MatchHistoryContainer>
      </InfiniteScrollList>
    )
  }
}
