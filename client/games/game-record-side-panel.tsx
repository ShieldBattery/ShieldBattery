import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { SbUserId } from '../../common/users/sb-user-id'
import { longTimestamp } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton } from '../material/button'
import { useAppSelector } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import { GamePlayersDisplay } from './game-players-display'
import {
  GameSidePanel,
  GameSidePanelActions,
  GameSidePanelChipsRow,
  GameSidePanelEmpty,
  GameSidePanelHeader,
  GameSidePanelSection,
  GameSidePanelSubline,
  GameSidePanelTitle,
} from './game-side-panel'
import { useGameReplayActions } from './use-game-replay-actions'

const GameTypeChip = styled.div`
  ${labelMedium};

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

const ViewResultsButton = styled(FilledButton)`
  flex-grow: 1;
`

export interface GameRecordSidePanelProps {
  game?: ReadonlyDeep<GameRecordJson>
  /** When set, the roster shows win/loss coloring for this user's perspective. */
  forUserId?: SbUserId
  alignWithFirstRow?: boolean
  onViewResults: (gameId: string) => void
  className?: string
}

/**
 * The shared right-hand detail panel for a selected game, used by the games list and match
 * history pages. Mirrors the replay library's inspector so the two feel like the same surface.
 */
export function GameRecordSidePanel({
  game,
  forUserId,
  alignWithFirstRow = false,
  onViewResults,
  className,
}: GameRecordSidePanelProps) {
  const { t } = useTranslation()

  if (!game) {
    return (
      <GameSidePanelEmpty alignWithFirstRow={alignWithFirstRow} className={className}>
        {t('games.sidePanel.empty', 'Select a game to see its details')}
      </GameSidePanelEmpty>
    )
  }

  return (
    <GameRecordSidePanelContent
      game={game}
      forUserId={forUserId}
      alignWithFirstRow={alignWithFirstRow}
      onViewResults={onViewResults}
      className={className}
    />
  )
}

interface GameRecordSidePanelContentProps {
  game: ReadonlyDeep<GameRecordJson>
  forUserId?: SbUserId
  alignWithFirstRow: boolean
  onViewResults: (gameId: string) => void
  className?: string
}

function GameRecordSidePanelContent({
  game,
  forUserId,
  alignWithFirstRow,
  onViewResults,
  className,
}: GameRecordSidePanelContentProps) {
  const { t } = useTranslation()
  const map = useAppSelector(s => s.maps.byId.get(game.mapId))
  const { replayInfo, onWatchReplay, onSaveReplay } = useGameReplayActions(game)

  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  return (
    <GameSidePanel map={map} alignWithFirstRow={alignWithFirstRow} className={className}>
      <GameSidePanelHeader>
        <GameSidePanelChipsRow>
          <GameTypeChip>{getGameTypeLabel(game, t)}</GameTypeChip>
        </GameSidePanelChipsRow>
        <GameSidePanelTitle>{mapName}</GameSidePanelTitle>
        <GameSidePanelSubline>{longTimestamp.format(game.startTime)}</GameSidePanelSubline>
      </GameSidePanelHeader>

      <GameSidePanelSection>
        <GamePlayersDisplay game={game} forUserId={forUserId} showTeamLabels={true} />
      </GameSidePanelSection>

      <GameSidePanelActions>
        <ViewResultsButton
          label={t('games.sidePanel.viewFullResults', 'View full results')}
          onClick={() => onViewResults(game.id)}
        />
        {IS_ELECTRON && replayInfo ? (
          <>
            <IconButton
              icon={<MaterialIcon icon='play_circle' />}
              title={t('gameDetails.buttonWatchReplay', 'Watch replay')}
              onClick={onWatchReplay}
            />
            <IconButton
              icon={<MaterialIcon icon='save' />}
              title={t('gameDetails.buttonSaveReplay', 'Save replay')}
              onClick={onSaveReplay}
            />
          </>
        ) : null}
      </GameSidePanelActions>
    </GameSidePanel>
  )
}
