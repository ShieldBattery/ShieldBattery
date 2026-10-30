import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { getErrorStack } from '../../common/errors'
import { GameRecordJson, getGameTypeLabel } from '../../common/games/games'
import { SbUserId } from '../../common/users/sb-user-id'
import { MaterialIcon } from '../icons/material/material-icon'
import logger from '../logging/logger'
import { MenuItem } from '../material/menu/item'
import { getServerOrigin } from '../network/server-url'
import { useAppSelector } from '../redux-hooks'
import { labelMedium } from '../styles/typography'
import { getGameResultsUrl } from './action-creators'
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
  /** Whose perspective the roster is ordered from: this user's team (or the user) is listed first. */
  forUserId?: SbUserId
  /** When true, the roster's per-player win/loss chips are hidden. */
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
  const { replayInfo, onWatchReplay, isStartingReplay } = useGameReplayActions(game.id)

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
  // replay the results page takes the primary slot. Copying the game link is always available
  // in the overflow menu, even when no replay is available.
  const canWatchReplay = replayInfo !== undefined && IS_ELECTRON
  const viewResultsLabel = t('games.sidePanel.viewFullResults', 'View full results')

  const actions = (
    <>
      {canWatchReplay ? (
        <GameSidePanelPrimaryAction
          label={t('gameDetails.buttonWatchReplay', 'Watch replay')}
          iconStart='play_arrow'
          disabled={isStartingReplay}
          onClick={onWatchReplay}
        />
      ) : (
        <GameSidePanelPrimaryAction
          label={viewResultsLabel}
          onClick={() => onViewResults(game.id)}
        />
      )}
      <GameSidePanelOverflow
        renderItems={({ closeMenu, openSubmenu }) => {
          const items = [
            <MenuItem
              key='copy-link'
              icon={<MaterialIcon icon='link' />}
              text={t('navigation.copyLink.defaultText', 'Copy link')}
              onClick={() => {
                closeMenu()
                navigator.clipboard
                  .writeText(getServerOrigin() + getGameResultsUrl(game.id))
                  .catch(err => logger.error(`Error writing to clipboard: ${getErrorStack(err)}`))
              }}
            />,
          ]

          if (canWatchReplay) {
            items.push(
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
            )
          } else if (replayInfo) {
            items.push(
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
            )
          }

          return items
        }}
        renderSubmenu={
          canWatchReplay
            ? ({ closeSubmenu }) => (
                <SaveReplayMenuContent replayInfo={replayInfo} onDismiss={closeSubmenu} />
              )
            : undefined
        }
      />
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
        <GamePlayersDisplay
          game={game}
          forUserId={forUserId}
          showTeamLabels={true}
          showPlayerResults={!spoilerFree}
          interactiveNames={true}
        />
      </GameSidePanelSection>

      <GameSidePanelActions>{actions}</GameSidePanelActions>
    </GameSidePanel>
  )
}
