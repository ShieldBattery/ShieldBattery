import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import { MenuItem } from '../material/menu/item'
import { useAppSelector } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import { GamePlayersDisplay } from './game-players-display'
import {
  GameSidePanel,
  GameSidePanelActions,
  GameSidePanelChipsRow,
  GameSidePanelEmpty,
  GameSidePanelOverflow,
  GameSidePanelPrimaryAction,
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
 * The shared right-hand detail panel for a selected game, used by the games list, match history
 * and league games pages and by the user profile's recent games. Mirrors the replay library's
 * inspector so the two feel like the same surface.
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

  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  const headerMeta = (
    <>
      <GameSidePanelChipsRow>
        <GameTypeChip>{getGameTypeLabel(game, t)}</GameTypeChip>
      </GameSidePanelChipsRow>
      <GameSidePanelRelativeTime timestampMs={game.startTime} />
    </>
  )

  // Watching is what people actually come to this panel for, so it takes the filled button
  // wherever the client can do it and everything else moves into the overflow. Without a watchable
  // replay the results page is the only thing left worth pressing, so it takes the primary slot,
  // and a game with no replay at all gets no overflow button rather than an empty menu.
  const canWatchReplay = replayInfo !== undefined && IS_ELECTRON
  const viewResultsLabel = t('games.sidePanel.viewFullResults', 'View full results')

  const actions = (
    <>
      {canWatchReplay ? (
        <GameSidePanelPrimaryAction
          label={t('gameDetails.buttonWatchReplay', 'Watch replay')}
          iconStart={<MaterialIcon icon='play_arrow' />}
          onClick={onWatchReplay}
        />
      ) : (
        <GameSidePanelPrimaryAction
          label={viewResultsLabel}
          onClick={() => onViewResults(game.id)}
        />
      )}
      {replayInfo ? (
        <GameSidePanelOverflow
          renderItems={({ closeMenu, openSubmenu }) =>
            canWatchReplay
              ? [
                  <MenuItem
                    key='view-full-results'
                    icon={<MaterialIcon icon='open_in_new' />}
                    text={viewResultsLabel}
                    onClick={() => {
                      closeMenu()
                      onViewResults(game.id)
                    }}
                  />,
                  <MenuItem
                    key='save-replay'
                    icon={<MaterialIcon icon='save' />}
                    text={t('gameDetails.buttonSaveReplay', 'Save replay')}
                    onClick={event => {
                      closeMenu()
                      openSubmenu(event)
                    }}
                  />,
                ]
              : [
                  <MenuItem
                    key='download-replay'
                    icon={<MaterialIcon icon='download' />}
                    text={t('gameDetails.buttonDownloadReplay', 'Download replay')}
                    onClick={() => {
                      closeMenu()
                      const a = document.createElement('a')
                      a.href = replayInfo.url
                      a.target = '_blank'
                      a.click()
                    }}
                  />,
                ]
          }
          renderSubmenu={
            canWatchReplay
              ? ({ closeSubmenu }) => (
                  <SaveReplayMenuContent replayInfo={replayInfo} onDismiss={closeSubmenu} />
                )
              : undefined
          }
        />
      ) : null}
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
        {/* Team names are always requested so a column whose result can't be reduced to one
            outcome (a disputed game, a computer player) still gets an overline; a resolved result
            replaces the name rather than joining it, so the overline never reads "Top · Win". */}
        <GamePlayersDisplay
          game={game}
          forUserId={forUserId}
          showTeamLabels={true}
          showTeamResults={!spoilerFree}
          interactiveNames={true}
        />
      </GameSidePanelSection>

      <GameSidePanelActions>{actions}</GameSidePanelActions>
    </GameSidePanel>
  )
}
