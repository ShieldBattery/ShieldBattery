import { Immutable } from 'immer'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { ReconciledResult, getResultLabel } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user-id'
import { navigateToGameResults } from '../games/action-creators'
import { GamePlayersDisplay } from '../games/game-players-display'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { batchGetMapInfo, openMapPreviewDialog } from '../maps/action-creators'
import { MapThumbnail } from '../maps/map-thumbnail'
import { TextButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { useAppDispatch, useAppSelector } from '../redux-hooks'
import { BodyMedium, bodyLarge, singleLine, titleSmall } from '../styles/typography'

const MatchHistoryRoot = styled.div`
  min-height: 304px;
  margin-bottom: 48px;
  /** 8 + 16px of internal padding in list = 24px */
  padding: 0 24px 0 8px;

  display: flex;
`

const GameList = styled.div`
  margin-right: 8px;
  flex-grow: 1;
  flex-shrink: 1;
`

const EmptyListText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  margin-left: 16px;
`

export interface MiniMatchHistoryProps {
  forUserId: SbUserId
  games: Immutable<GameRecordJson[]>
}

export function MiniMatchHistory({ forUserId, games }: MiniMatchHistoryProps) {
  const { t } = useTranslation()
  const [activeGameId, setActiveGameId] = useState(games.length > 0 ? games[0].id : undefined)
  const activeGame = useMemo(() => {
    if (!activeGameId) {
      return undefined
    }

    return games.find(g => g.id === activeGameId)
  }, [activeGameId, games])

  return (
    <MatchHistoryRoot>
      <GameList>
        {games.map((g, i) => (
          <ConnectedGameListEntry
            key={i}
            forUserId={forUserId}
            game={g}
            onSetActive={setActiveGameId}
            active={g.id === activeGameId}
          />
        ))}
        {games.length === 0 ? (
          <EmptyListText>{t('common.lists.empty', 'Nothing to see here')}</EmptyListText>
        ) : null}
      </GameList>
      <ConnectedGamePreview game={activeGame} forUserId={forUserId} />
    </MatchHistoryRoot>
  )
}

const GameListEntryRoot = styled.button<{ $active: boolean }>`
  ${buttonReset};

  width: 100%;
  height: 64px;
  padding: 12px 16px;

  border-radius: 4px;
  text-align: left;

  background-color: ${props => (props.$active ? 'var(--theme-container-low)' : 'transparent')};

  & + & {
    margin-top: 8px;
  }
`

const GameListEntryTextRow = styled.div<{ $color?: 'primary' | 'secondary' }>`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  color: ${props =>
    props.$color === 'secondary' ? 'var(--theme-on-surface-variant)' : 'var(--theme-on-surface)'};
`

const MapName = styled.div`
  ${titleSmall};
  ${singleLine};
  flex-shrink: 1;
`

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
  ${titleSmall};
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
  padding-left: 8px;
  flex-shrink: 0;
`

export interface ConnectedGameListEntryProps {
  forUserId: SbUserId
  game: Immutable<GameRecordJson>
  onSetActive: (gameId: string) => void
  active: boolean
}

export function ConnectedGameListEntry({
  forUserId,
  game,
  onSetActive,
  active,
}: ConnectedGameListEntryProps) {
  const { t } = useTranslation()

  const { id } = game
  const onClick = useCallback(() => {
    onSetActive(id)
  }, [id, onSetActive])
  const onDoubleClick = useCallback(() => {
    navigateToGameResults(id)
  }, [id])
  const [buttonProps, rippleRef] = useButtonState({ onClick, onDoubleClick })

  const map = useAppSelector(s => s.maps.byId.get(game.mapId))

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

  const matchType = getGameTypeLabel(game, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  return (
    <GameListEntryRoot {...buttonProps} $active={active}>
      <GameListEntryTextRow $color='primary'>
        <MapName title={mapName}>{mapName}</MapName>
        <GameListEntryResult $result={result}>{getResultLabel(result, t)}</GameListEntryResult>
      </GameListEntryTextRow>

      <GameListEntryTextRow $color='secondary'>
        <BodyMedium>{matchType}</BodyMedium>
        <Tooltip text={longTimestamp.format(startTime)} position='left'>
          <BodyMedium>{narrowDuration.format(startTime)}</BodyMedium>
        </Tooltip>
      </GameListEntryTextRow>

      <Ripple ref={rippleRef} />
    </GameListEntryRoot>
  )
}

const GamePreviewRoot = styled.div`
  width: 276px;
  flex-grow: 0;
  flex-shrink: 0;

  display: flex;
  flex-direction: column;
`

const GamePreviewDetails = styled.div`
  position: relative;
  width: 100%;
  flex-grow: 1;
  padding: 16px 16px 20px;

  display: flex;
  flex-direction: column;

  --_surface-bg: var(--theme-container-low);
  background-color: var(--_surface-bg);
  border-radius: 4px;
`

const NoGameText = styled.div`
  ${bodyLarge};
  color: var(--theme-on-surface-variant);
  text-align: center;
`

const StyledGamePlayersDisplay = styled(GamePlayersDisplay)`
  position: absolute;
  bottom: 12px; /* 12px + 8px from player bottom margin = 20px */
  left: 16px;
  right: 16px;

  padding-top: 24px;

  background: linear-gradient(
    to bottom,
    rgb(from var(--_surface-bg) r g b / 0),
    rgb(from var(--_surface-bg) r g b / 50%) 12px,
    rgb(from var(--_surface-bg) r g b / 80%) 80%,
    rgb(from var(--_surface-bg) r g b) 92%
  );
`

const StyledMapThumbnail = styled(MapThumbnail)`
  height: auto;
`

export interface ConnectedGamePreviewProps {
  game?: Immutable<GameRecordJson>
  forUserId: SbUserId
}

export function ConnectedGamePreview({ game, forUserId }: ConnectedGamePreviewProps) {
  const dispatch = useAppDispatch()
  const { t } = useTranslation()

  const gameId = game?.id
  const mapId = game?.mapId
  const map = useAppSelector(s => (mapId ? s.maps.byId.get(mapId) : undefined))

  const onMapPreview = useCallback(() => {
    if (!map) {
      return
    }

    dispatch(openMapPreviewDialog(map.id))
  }, [map, dispatch])

  const onViewDetails = useCallback(() => {
    if (gameId) {
      navigateToGameResults(gameId)
    }
  }, [gameId])

  useEffect(() => {
    if (mapId) {
      dispatch(batchGetMapInfo(mapId))
    }
  }, [dispatch, mapId])

  if (!game) {
    return (
      <GamePreviewRoot>
        <GamePreviewDetails>
          <NoGameText>{t('user.miniMatchHistory.noGameSelected', 'No game selected')}</NoGameText>
        </GamePreviewDetails>
      </GamePreviewRoot>
    )
  }

  return (
    <GamePreviewRoot>
      <GamePreviewDetails>
        {map ? (
          <StyledMapThumbnail key={map.hash} map={map} size={256} onPreview={onMapPreview} />
        ) : null}
        <StyledGamePlayersDisplay game={game} forUserId={forUserId} />
      </GamePreviewDetails>
      <TextButton
        label={t('user.miniMatchHistory.viewDetails', 'View details')}
        onClick={onViewDetails}
      />
    </GamePreviewRoot>
  )
}
