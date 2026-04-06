import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  ALL_GAME_FORMATS,
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
  makeEncodedMatchupString,
} from '../../common/games/game-filters'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import { getResultLabel, ReconciledResult } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user-id'
import { navigateToGameResults } from '../games/action-creators'
import { GameFilterBar } from '../games/game-filter-bar'
import { GamePlayersDisplay } from '../games/game-players-display'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { ReduxMapThumbnail } from '../maps/map-thumbnail'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { elevationPlus1 } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useLocationSearchParam } from '../navigation/router-hooks'
import { useRefreshToken } from '../network/refresh-token'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { styledWithAttrs } from '../styles/styled-with-attrs'
import {
  bodyLarge,
  bodyMedium,
  headlineMedium,
  labelMedium,
  singleLine,
  titleSmall,
} from '../styles/typography'
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

function parseMatchup(value: string): EncodedMatchupString | undefined {
  return value ? makeEncodedMatchupString(value) : undefined
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
  const matchup = parseMatchup(matchupParam)

  const [gameIds, setGameIds] = useState<string[]>()
  const [hasMoreGames, setHasMoreGames] = useState(true)
  const [isLoadingMoreGames, setIsLoadingMoreGames] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>(undefined)
  const [refreshToken, triggerRefresh] = useRefreshToken()

  const games = useAppSelector(
    s =>
      gameIds
        ?.map(id => s.games.byId.get(id))
        .filter((g): g is GameRecordJson => g !== undefined) ?? [],
  )

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
      <MatchHistoryEntry key={game.id} forUserId={userId} game={game} />
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

const MatchHistoryEntryRoot = styled.button`
  ${buttonReset};

  width: 100%;
  min-height: 80px;
  padding-top: 8px;
  padding-bottom: 8px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const BaseCell = styled.div`
  height: 100%;
  flex: 1 1 auto;
`

const ResultAndDateCell = styled(BaseCell)`
  width: 128px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayersCell = styled(BaseCell)`
  width: 328px;
`

const GameLengthCell = styled(BaseCell)`
  ${headlineMedium};
  width: 128px;

  display: flex;
  justify-content: flex-end;
`

const MapAndGameTypeCell = styled(BaseCell)`
  width: 196px;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
`

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
  ${headlineMedium};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return 'var(--theme-positive)'
      case 'loss':
        return 'var(--theme-negative)'
      default:
        return 'var(--theme-on-surface-variant)'
    }
  }};
  flex-shrink: 0;
`

const GameDate = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const MapNameAndGameTypeContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
`

const MapName = styled.div`
  ${titleSmall};
  ${singleLine};

  min-width: 0;
  width: 100%;
  text-align: right;
`

const GameType = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);

  min-width: 0;
  width: 100%;
  text-align: right;
`

const StyledMapThumbnail = styled(ReduxMapThumbnail)`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

const MapNoImageContainer = styled.div`
  ${elevationPlus1};
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  display: flex;
  justify-content: center;
  align-items: center;

  border-radius: 4px;
  background-color: var(--theme-container);
`

const MapNoImageIcon = styledWithAttrs(MaterialIcon, { icon: 'question_mark', size: 36 })`
  opacity: 0.5;
`

function MatchHistoryEntry({ forUserId, game }: { forUserId: SbUserId; game: GameRecordJson }) {
  const { t } = useTranslation()
  const map = useAppSelector(s => s.maps.byId.get(game.mapId))

  const [buttonProps, rippleRef] = useButtonState({
    onClick: () => navigateToGameResults(game.id),
  })

  const { results, startTime } = game
  const result = useMemo(() => {
    if (!results) {
      return 'unknown'
    }

    for (const [userId, r] of results) {
      if (userId === forUserId) {
        return r.result
      }
    }

    return 'unknown'
  }, [results, forUserId])

  const gameType = getGameTypeLabel(game, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  return (
    <MatchHistoryEntryRoot {...buttonProps}>
      <ResultAndDateCell>
        <GameListEntryResult $result={result}>
          {getResultLabel(result, t, true)}
        </GameListEntryResult>
        <Tooltip text={longTimestamp.format(startTime)} position='right'>
          <GameDate>{narrowDuration.format(startTime)}</GameDate>
        </Tooltip>
      </ResultAndDateCell>

      <PlayersCell>
        <GamePlayersDisplay game={game} forUserId={forUserId} showTeamLabels={false} />
      </PlayersCell>

      <GameLengthCell>
        {game.gameLength ? getGameDurationString(game.gameLength) : '—'}
      </GameLengthCell>

      <MapAndGameTypeCell>
        <MapNameAndGameTypeContainer>
          <MapName title={mapName}>{mapName}</MapName>
          <GameType>{gameType}</GameType>
        </MapNameAndGameTypeContainer>

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
            <MapNoImageIcon />
          </MapNoImageContainer>
        )}
      </MapAndGameTypeCell>

      <Ripple ref={rippleRef} />
    </MatchHistoryEntryRoot>
  )
}
