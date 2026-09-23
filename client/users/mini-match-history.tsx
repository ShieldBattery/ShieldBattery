import { Immutable } from 'immer'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { getResultLabel, ReconciledResult } from '../../common/games/results'
import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { navigateToGameResults } from '../games/action-creators'
import { GameRecordSidePanel } from '../games/game-record-side-panel'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { TextButton, useButtonState } from '../material/button'
import { buttonReset } from '../material/button-reset'
import { LinkButton } from '../material/link-button'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { useAppSelector } from '../redux-hooks'
import { bodyLarge, BodyMedium, singleLine, titleSmall } from '../styles/typography'
import { UserProfileSubPage } from './user-profile-sub-page'

const MatchHistoryRoot = styled.div`
  min-height: 304px;
  margin-bottom: 48px;
  /** 8 + 16px of internal padding in list = 24px */
  padding: 0 24px 0 8px;

  display: flex;
  align-items: flex-start;
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

const ViewFullHistoryLink = styled(LinkButton)`
  display: flex;
`

const ViewFullHistoryButton = styled(TextButton)`
  width: 100%;
`

export interface MiniMatchHistoryProps {
  forUserId: SbUserId
  games: Immutable<GameRecordJson[]>
}

export function MiniMatchHistory({ forUserId, games }: MiniMatchHistoryProps) {
  const { t } = useTranslation()
  const username = useAppSelector(s => s.users.byId.get(forUserId)?.name)
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
        {games.length > 0 ? (
          <ViewFullHistoryLink
            href={urlPath`/users/${forUserId}/${username}/${UserProfileSubPage.MatchHistory}`}>
            <ViewFullHistoryButton
              styledAs='div'
              label={t('user.miniMatchHistory.viewFullHistory', 'View full match history')}
              tabIndex={0}
            />
          </ViewFullHistoryLink>
        ) : null}
      </GameList>
      <GameRecordSidePanel
        game={activeGame}
        forUserId={forUserId}
        onViewResults={navigateToGameResults}
      />
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
