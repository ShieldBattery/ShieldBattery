import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import { ReconciledResult, getResultLabel } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user'
import { navigateToGameResults } from '../games/action-creators'
import { GamePlayersDisplay } from '../games/game-players-display'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import InfiniteScrollList from '../lists/infinite-scroll-list'
import { MapThumbnail } from '../maps/map-thumbnail'
import { useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { shadow1dp } from '../material/shadows'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { useStableCallback } from '../state-hooks'
import {
  background500,
  colorError,
  colorNegative,
  colorPositive,
  colorTextFaint,
  colorTextSecondary,
} from '../styles/colors'
import { body1, body2, caption, headline4, singleLine, subtitle1 } from '../styles/typography'
import { searchMatchHistory } from './action-creators'

const NoResults = styled.div`
  ${subtitle1};

  color: ${colorTextFaint};
`

const ErrorText = styled.div`
  ${subtitle1};

  color: ${colorError};
`

const SearchResults = styled.div`
  width: 100%;
  padding: 0 24px;

  display: flex;
  flex-direction: column;
`

export function ConnectedMatchHistory({ userId }: { userId: SbUserId }) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()

  const [games, setGames] = useState<GameRecordJson[]>()
  const [hasMoreGames, setHasMoreGames] = useState(true)

  const [isLoadingMoreGames, setIsLoadingMoreGames] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>()

  const onLoadMoreGames = useStableCallback(() => {
    setIsLoadingMoreGames(true)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    dispatch(
      searchMatchHistory(userId, games?.length ?? 0, {
        signal: abortControllerRef.current.signal,
        onSuccess: data => {
          setIsLoadingMoreGames(false)
          setGames((games ?? []).concat(data.games))
          setHasMoreGames(data.hasMoreGames)
        },
        onError: err => {
          setIsLoadingMoreGames(false)
          setSearchError(err)
        },
      }),
    )
  })

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  if (searchError) {
    return (
      <SearchResults>
        <ErrorText>
          {t(
            'user.matchHistory.retrievingError',
            'There was an error retrieving the match history.',
          )}
        </ErrorText>
      </SearchResults>
    )
  } else if (games?.length === 0) {
    return (
      <SearchResults>
        <NoResults>{t('user.matchHistory.noMatchingGames', 'No matching games.')}</NoResults>
      </SearchResults>
    )
  } else {
    const gameItems = (games ?? []).map(game => (
      <MatchHistoryEntry key={game.id} forUserId={userId} game={game} />
    ))

    return (
      <InfiniteScrollList
        nextLoadingEnabled={true}
        isLoadingNext={isLoadingMoreGames}
        hasNextData={hasMoreGames}
        onLoadNextData={onLoadMoreGames}>
        <SearchResults>{gameItems}</SearchResults>
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
  width: 256px;
`

const GameLengthCell = styled(BaseCell)`
  ${headline4};
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
  ${headline4};
  color: ${props => {
    switch (props.$result) {
      case 'win':
        return colorPositive
      case 'loss':
        return colorNegative
      default:
        return colorTextSecondary
    }
  }};
  flex-shrink: 0;
`

const GameDate = styled.div`
  ${caption};
  ${singleLine};
  color: ${colorTextSecondary};
`

const MapNameAndGameTypeContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
`

const MapName = styled.div`
  ${body2};
  ${singleLine};

  min-width: 0;
  width: 100%;
`

const GameType = styled.div`
  ${body1};
  ${singleLine};
  color: ${colorTextSecondary};

  min-width: 0;
  width: 100%;
`

const StyledMapThumbnail = styled(MapThumbnail)`
  ${shadow1dp};
  width: 64px;
  height: 64px;
  flex-shrink: 0;
`

const MapNoImageContainer = styled.div`
  ${shadow1dp};
  width: 64px;
  height: 64px;
  flex-shrink: 0;

  display: flex;
  justify-content: center;
  align-items: center;

  border-radius: 2px;
  background-color: ${background500};
`

const MapNoImageIcon = styled(MaterialIcon).attrs({ icon: 'question_mark', size: 36 })`
  opacity: 0.5;
`

function MatchHistoryEntry({ forUserId, game }: { forUserId: SbUserId; game: GameRecordJson }) {
  const { t } = useTranslation()
  const map = useAppSelector(s => s.maps2.byId.get(game.mapId))

  const onClick = useStableCallback(() => {
    navigateToGameResults(game.id)
  })
  const [buttonProps, rippleRef] = useButtonState({ onClick })

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
        <GamePlayersDisplay game={game} showTeamLabels={false} />
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
          <StyledMapThumbnail key={map.hash} map={map} size={64} forceAspectRatio={1} />
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
