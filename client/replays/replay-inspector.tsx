import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getGameDurationString } from '../../common/games/games'
import { filterColorCodes } from '../../common/maps'
import { ReplayLibraryEntry } from '../../common/replays-library'
import {
  GameSidePanel,
  GameSidePanelActions,
  GameSidePanelChipsRow,
  GameSidePanelEmpty,
  GameSidePanelHeader,
  GameSidePanelSection,
  GameSidePanelSubline,
  GameSidePanelTitle,
} from '../games/game-side-panel'
import { PlayerTeamsDisplay } from '../games/player-teams-display'
import { NarrowDuration } from '../i18n/date-formats'
import { MaterialIcon } from '../icons/material/material-icon'
import Logo from '../logos/logo-no-bg.svg'
import { FilledButton, IconButton } from '../material/button'
import { MenuItem } from '../material/menu/item'
import { MenuList } from '../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../material/popover'
import { bodyMedium, labelMedium } from '../styles/typography'
import { useSbGameMap } from './replay-hooks'
import {
  getReplayDisplayTeams,
  playersToDisplayTeams,
  shouldShowTeamLabels,
} from './replay-library-helpers'

const SbSourceLogo = styled(Logo)`
  width: 16px;
  height: 16px;
`

const SourceBadgeSb = styled.div`
  ${labelMedium};

  display: flex;
  align-items: center;
  gap: 4px;

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
`

const SourceBadgeBnet = styled.div`
  ${labelMedium};

  padding: 2px 8px;

  border-radius: 6px;
  border: 1px solid var(--theme-outline);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
`

const ErrorNote = styled.div`
  ${bodyMedium};
  color: var(--theme-on-surface-variant);
`

const WatchButton = styled(FilledButton)`
  flex-grow: 1;
`

export interface ReplayInspectorProps {
  entry: ReplayLibraryEntry | undefined
  /** True when the list is day-grouped, so the panel's top should align with the first row. */
  alignWithFirstRow: boolean
  onWatch: (entry: ReplayLibraryEntry) => void
  onReveal: (entry: ReplayLibraryEntry) => void
}

export function ReplayInspector({
  entry,
  alignWithFirstRow,
  onWatch,
  onReveal,
}: ReplayInspectorProps) {
  const { t } = useTranslation()
  const computerLabel = t('game.playerName.computer', 'Computer')
  const [anchor, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('right', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })
  const map = useSbGameMap(entry?.sbGameId)

  if (!entry) {
    return (
      <GameSidePanelEmpty alignWithFirstRow={alignWithFirstRow}>
        {t('replays.library.inspector.empty', 'Select a replay to see its details')}
      </GameSidePanelEmpty>
    )
  }

  const layout = entry.parseError ? undefined : getReplayDisplayTeams(entry.players)
  const teamLabels =
    layout && shouldShowTeamLabels(layout)
      ? layout.teams.map((_, i) =>
          t('game.teamName.number', { defaultValue: 'Team {{teamNumber}}', teamNumber: i + 1 }),
        )
      : undefined

  const chips = (
    <GameSidePanelChipsRow>
      {entry.sbGameId ? (
        <SourceBadgeSb>
          <SbSourceLogo />
          {t('replays.library.sourceTagSb', 'SB')}
        </SourceBadgeSb>
      ) : (
        <SourceBadgeBnet>{t('replays.library.sourceTagBnet', 'B.NET')}</SourceBadgeBnet>
      )}
    </GameSidePanelChipsRow>
  )

  const actions = (
    <GameSidePanelActions>
      <WatchButton
        label={t('replays.library.watchReplay', 'Watch replay')}
        iconStart={<MaterialIcon icon='play_arrow' />}
        onClick={() => onWatch(entry)}
      />
      <IconButton
        ref={anchor}
        icon={<MaterialIcon icon='more_vert' />}
        title={t('replays.library.moreActions', 'More actions')}
        onClick={openMenu}
      />
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='right'
        originY='top'>
        <MenuList dense={true}>
          <MenuItem
            icon={<MaterialIcon icon='folder_open' />}
            text={t('replays.library.showInExplorer', 'Show in Explorer')}
            onClick={() => {
              closeMenu()
              onReveal(entry)
            }}
          />
        </MenuList>
      </Popover>
    </GameSidePanelActions>
  )

  return (
    <GameSidePanel map={map} alignWithFirstRow={alignWithFirstRow}>
      {entry.parseError ? (
        <>
          <GameSidePanelHeader>
            {/*
              No source badge: an unreadable replay's source is genuinely unknown (we couldn't read
              the embedded SB section), so the SB/B.NET distinction can't be made here.
            */}
            <GameSidePanelTitle>{entry.fileName}</GameSidePanelTitle>
          </GameSidePanelHeader>
          <ErrorNote>
            {t('replays.library.inspector.parseError', 'This replay could not be read.')}
          </ErrorNote>
        </>
      ) : (
        <>
          <GameSidePanelHeader>
            {chips}
            {!map ? (
              <GameSidePanelTitle>{filterColorCodes(entry.mapName)}</GameSidePanelTitle>
            ) : null}
            <GameSidePanelSubline>
              <NarrowDuration to={entry.gameTime} />
              <span>·</span>
              <span>{getGameDurationString((entry.durationFrames * 1000) / 24)}</span>
            </GameSidePanelSubline>
          </GameSidePanelHeader>
          <GameSidePanelSection>
            <PlayerTeamsDisplay
              teams={playersToDisplayTeams(layout!, computerLabel)}
              teamLabels={teamLabels}
            />
          </GameSidePanelSection>
        </>
      )}

      {actions}
    </GameSidePanel>
  )
}
