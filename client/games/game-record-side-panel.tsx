import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { FilledButton, IconButton } from '../material/button'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { useAppSelector } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import { GamePlayersDisplay } from './game-players-display'
import {
  GameSidePanel,
  GameSidePanelActions,
  GameSidePanelChipsRow,
  GameSidePanelEmpty,
  GameSidePanelRelativeTime,
  GameSidePanelSection,
  GameSidePanelTitle,
} from './game-side-panel'
import { SaveReplayMenuContent } from './save-replay-menu'
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
  /** When true, the roster's per-column win/loss result is hidden. */
  spoilerFree?: boolean
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
  spoilerFree = false,
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
      spoilerFree={spoilerFree}
      alignWithFirstRow={alignWithFirstRow}
      onViewResults={onViewResults}
      className={className}
    />
  )
}

interface GameRecordSidePanelContentProps {
  game: ReadonlyDeep<GameRecordJson>
  forUserId?: SbUserId
  spoilerFree: boolean
  alignWithFirstRow: boolean
  onViewResults: (gameId: string) => void
  className?: string
}

function GameRecordSidePanelContent({
  game,
  forUserId,
  spoilerFree,
  alignWithFirstRow,
  onViewResults,
  className,
}: GameRecordSidePanelContentProps) {
  const { t } = useTranslation()
  const map = useAppSelector(s => s.maps.byId.get(game.mapId))
  const { replayInfo, onWatchReplay } = useGameReplayActions(game)
  const [saveAnchor, saveAnchorX, saveAnchorY, refreshSaveAnchorPos] = useRefAnchorPosition(
    'right',
    'bottom',
  )
  const [saveMenuOpen, openSaveMenu, closeSaveMenu] = usePopoverController({
    refreshAnchorPos: refreshSaveAnchorPos,
  })

  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  const headerMeta = (
    <>
      <GameSidePanelChipsRow>
        <GameTypeChip>{getGameTypeLabel(game, t)}</GameTypeChip>
      </GameSidePanelChipsRow>
      <GameSidePanelRelativeTime timestampMs={game.startTime} />
    </>
  )

  return (
    <GameSidePanel
      map={map}
      headerMeta={headerMeta}
      alignWithFirstRow={alignWithFirstRow}
      className={className}>
      {/* The map thumbnail carries its own name label; a title is only needed when there's no
          thumbnail for it to live on. */}
      {!map ? <GameSidePanelTitle>{mapName}</GameSidePanelTitle> : null}

      <GameSidePanelSection>
        {/* The column overline holds either the team name or its result; both at once read as
            noise, so team names only fill in while spoiler-free hides the results. */}
        <GamePlayersDisplay
          game={game}
          forUserId={forUserId}
          showTeamLabels={spoilerFree}
          showTeamResults={!spoilerFree}
          interactiveNames={true}
        />
      </GameSidePanelSection>

      <GameSidePanelActions>
        <ViewResultsButton
          label={t('games.sidePanel.viewFullResults', 'View full results')}
          onClick={() => onViewResults(game.id)}
        />
        {replayInfo && IS_ELECTRON ? (
          <>
            <IconButton
              icon={<MaterialIcon icon='play_circle' />}
              title={t('gameDetails.buttonWatchReplay', 'Watch replay')}
              onClick={onWatchReplay}
            />
            <IconButton
              ref={saveAnchor}
              icon={<MaterialIcon icon='save' />}
              title={t('gameDetails.buttonSaveReplay', 'Save replay')}
              onClick={openSaveMenu}
            />
            <Popover
              open={saveMenuOpen}
              onDismiss={closeSaveMenu}
              anchorX={saveAnchorX ?? 0}
              anchorY={saveAnchorY ?? 0}
              originX='right'
              originY='top'>
              <SaveReplayMenuContent replayInfo={replayInfo} onDismiss={closeSaveMenu} />
            </Popover>
          </>
        ) : null}
        {replayInfo && !IS_ELECTRON ? (
          <IconButton
            icon={<MaterialIcon icon='download' />}
            title={t('gameDetails.buttonDownloadReplay', 'Download replay')}
            onClick={() => {
              const a = document.createElement('a')
              a.href = replayInfo.url
              a.target = '_blank'
              a.click()
            }}
          />
        ) : null}
      </GameSidePanelActions>
    </GameSidePanel>
  )
}
