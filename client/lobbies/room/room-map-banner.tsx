import { useAtomValue } from 'jotai'
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { gameTypeToLabel } from '../../../common/games/game-type'
import { tilesetToName } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ConnectedAvatar } from '../../avatars/avatar'
import { MaterialIcon } from '../../icons/material/material-icon'
import { MapInfoImage } from '../../maps/map-image'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { IconButton, TextButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover, usePopoverController, useRefAnchorPosition } from '../../material/popover'
import { useAppSelector } from '../../redux-hooks'
import {
  bodyMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
} from '../../styles/typography'
import { LobbyScoreboard } from './lobby-scoreboard'
import { getWinsByUser, lobbySeriesAtom, LobbySeriesGame } from './room-atoms'
import { formatGameDuration, memberCount, SectionLabel, TeamArrangement } from './room-parts'

const BannerRoot = styled.div`
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  isolation: isolate;

  border-bottom: 1px solid var(--theme-outline-variant);
`

const Backdrop = styled.div`
  position: absolute;
  inset: 0;

  filter: saturate(0.6) brightness(0.65) contrast(1.1);
  /* Zoomed past the frame so the crop reads as terrain, not a shrunken whole map. */
  transform: scale(1.3);
`

const TintLayer = styled.div`
  position: absolute;
  inset: 0;

  background-color: var(--theme-primary);
  mix-blend-mode: color;
  opacity: 0.4;
`

const Scrim = styled.div`
  position: absolute;
  inset: 0;

  background: linear-gradient(
    97deg,
    rgb(from var(--theme-surface) r g b / 0.92) 0%,
    rgb(from var(--theme-surface) r g b / 0.78) 34%,
    rgb(from var(--theme-surface) r g b / 0.25) 62%,
    rgb(from var(--theme-surface) r g b / 0.05) 100%
  );
`

const Content = styled.div`
  position: relative;

  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px;
`

/**
 * Sized by the map's own aspect ratio. The frame must have a definite height of its own: the
 * thumbnail inside sizes itself with percentage heights, which collapse to zero against an
 * auto-height ancestor.
 */
const ThumbnailCard = styled.div<{ $aspectRatio: number }>`
  height: 256px;
  aspect-ratio: ${props => props.$aspectRatio};
  flex-shrink: 0;

  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgb(0 0 0 / 0.5);
  outline: 1px solid rgb(from var(--theme-on-surface) r g b / 0.12);
`

const InfoColumn = styled.div`
  align-self: stretch;
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 12px;
`

const StatsRow = styled.div`
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
`

const StatBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`

const StatLabel = styled.div`
  ${labelSmall};
  ${singleLine};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const StatValue = styled.div`
  ${titleMedium};
  ${singleLine};
`

/** The slanted hairline between stats, styled after a broadcast ticker's dividers. */
const StatDivider = styled.div`
  width: 1px;
  height: 28px;
  flex-shrink: 0;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.16);
  transform: skewX(-14deg);
`

/**
 * `margin-left` cancels `TextButton`'s 8px start padding, so the first button's label lines up
 * with the stat labels above it.
 */
const HostTools = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: -8px;
`

const HostToolButton = styled(TextButton)`
  min-width: 0;
  min-height: 32px;
  padding-inline: 8px 10px;

  color: var(--theme-on-surface-variant);
`

const TimelineSection = styled.div`
  margin-top: auto;

  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`

const TimelineLabelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`

const LeaderChip = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
`

const LeaderAvatar = styled(ConnectedAvatar)`
  width: 20px;
  height: 20px;
  flex-shrink: 0;
`

const LeaderWins = styled.div`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

const TimelineSpacer = styled.div`
  flex-grow: 1;
`

const AllGamesButton = styled.button`
  ${buttonReset};
  ${labelMedium};
  color: var(--theme-on-surface-variant);

  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px 6px;
  margin: -2px -6px;

  border-radius: 6px;

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }

  &:hover {
    color: var(--theme-on-surface);
  }
`

const TimelineStrip = styled.div`
  display: flex;
  align-items: stretch;
  gap: 8px;
  min-width: 0;
`

const OverflowChip = styled.button`
  ${buttonReset};
  ${labelMedium};
  align-self: center;
  padding: 6px 10px;

  border-radius: 999px;
  background-color: rgb(from var(--theme-container-low) r g b / 0.7);
  color: var(--theme-on-surface-variant);

  &:hover {
    background-color: rgb(from var(--theme-container-low) r g b / 0.9);
    color: var(--theme-on-surface);
  }
`

const GameTileButton = styled.button`
  ${buttonReset};
  min-width: 96px;
  padding: 8px 12px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;

  border-radius: 8px;
  background-color: rgb(from var(--theme-container-low) r g b / 0.7);
  backdrop-filter: blur(4px);
  outline: 1px solid rgb(from var(--theme-on-surface) r g b / 0.08);
  text-align: left;

  &:hover,
  &:focus-visible {
    background-color: rgb(from var(--theme-container-low) r g b / 0.9);
    outline-color: rgb(from var(--theme-on-surface) r g b / 0.2);
  }
`

const GameTileTopRow = styled.div`
  display: flex;
  justify-content: space-between;
  gap: 8px;
`

const GameTileNumber = styled.span`
  ${labelMedium};
`

const GameTileDuration = styled.span`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
`

const GameTileBottomRow = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`

const GameTileTrophy = styled.span`
  display: flex;
  flex-shrink: 0;
  color: var(--theme-amber);
`

const GameTileWinner = styled.span`
  ${bodyMedium};
  ${singleLine};
`

/** Fades the upcoming slot in and out, so an idle lobby still reads as waiting on something. */
const breathe = keyframes`
  0%,
  100% {
    opacity: 0.65;
  }
  50% {
    opacity: 1;
  }
`

const NextSlotRoot = styled.div<{ $state: 'idle' | 'countdown' | 'loading' }>`
  min-width: 96px;
  padding: 8px 12px;

  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 4px;

  border-radius: 8px;
  border: 1px dashed var(--theme-outline);
  background: none;

  ${props =>
    props.$state !== 'idle'
      ? css`
          border: 1px solid var(--theme-primary);
        `
      : ''}

  ${props =>
    props.$state === 'idle'
      ? css`
          animation: ${breathe} 3s ease-in-out infinite;

          @media (prefers-reduced-motion: reduce) {
            animation: none;
          }
        `
      : ''}
`

const NextSlotLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const NextSlotNumeral = styled.div`
  ${titleLarge};
`

const NextSlotValue = styled.div`
  ${titleMedium};
  ${singleLine};
`

const SeriesList = styled.div`
  min-width: 360px;
  /**
   * The popover sizes its frame to the space between the anchor and the screen edge but leaves
   * scrolling to its content, so the list caps itself to that space (inherited from the popover
   * as --sb-popover-max-height) or a comfortable reading height, whichever is smaller.
   */
  max-height: min(560px, var(--sb-popover-max-height, 560px));
  padding: 12px 16px;

  display: flex;
  flex-direction: column;
  gap: 12px;

  overflow-y: auto;
`

const SeriesSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

/** `SectionLabel` carries a 4px horizontal padding meant for the roster rail; the popover's
 * sections instead need a flush left edge shared with the rows below them. */
const PopoverSectionLabel = styled(SectionLabel)`
  padding: 0;
`

const SeriesRow = styled.div`
  min-height: 44px;
  gap: 10px;

  display: flex;
  align-items: center;

  border-radius: 6px;

  &:hover {
    background-color: rgb(from var(--theme-on-surface) r g b / 0.08);
  }
`

const SeriesGameNumber = styled.div`
  ${labelMedium};
  width: 24px;
  flex-shrink: 0;
  color: var(--theme-on-surface-variant);
`

const SeriesMain = styled.div`
  flex-grow: 1;
  min-width: 0;

  display: flex;
  flex-direction: column;
  gap: 2px;
`

const SeriesMapName = styled.div`
  ${bodyMedium};
  ${singleLine};
`

const SeriesFactRow = styled.div`
  ${labelSmall};
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--theme-on-surface-variant);
`

const SeriesTrophyIcon = styled(MaterialIcon)`
  flex-shrink: 0;
  color: var(--theme-amber);
`

const SeriesWinner = styled.span`
  ${singleLine};
  min-width: 0;
`

const SeriesFactDivider = styled.span`
  flex-shrink: 0;
`

const SeriesDuration = styled.span`
  ${singleLine};
  flex-shrink: 0;
`

const SeriesAction = styled(IconButton)`
  width: 32px;
  min-height: 32px;
  padding: 0;
  flex-shrink: 0;
`

/** One finished game from the lobby's games so far: what was played, who took it, and how to revisit it. */
function SeriesGameRow({
  game,
  gameNumber,
  onWatchReplay,
  onViewGameSummary,
}: {
  game: LobbySeriesGame
  gameNumber: number
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const mapName = useAppSelector(s => s.maps.byId.get(game.mapId)?.name)

  const winningTeam = game.teams[game.winningTeamIndex]
  const winnerLabel = `Team ${game.winningTeamIndex + 1}${
    winningTeam?.name ? ` · ${winningTeam.name}` : ''
  }`

  return (
    <SeriesRow>
      <SeriesGameNumber>G{gameNumber}</SeriesGameNumber>
      <SeriesMain>
        <SeriesMapName title={mapName}>{mapName ?? 'unknown map'}</SeriesMapName>
        <SeriesFactRow>
          <SeriesTrophyIcon icon='trophy' size={14} filled />
          <SeriesWinner>{winnerLabel}</SeriesWinner>
          <SeriesFactDivider>·</SeriesFactDivider>
          <SeriesDuration>{formatGameDuration(game.durationMs)}</SeriesDuration>
        </SeriesFactRow>
      </SeriesMain>
      <SeriesAction
        icon={<MaterialIcon icon='play_arrow' />}
        title='Watch replay'
        onClick={() => onWatchReplay(game.gameId)}
      />
      <SeriesAction
        icon={<MaterialIcon icon='summarize' />}
        title='Full summary'
        onClick={() => onViewGameSummary(game.gameId)}
      />
    </SeriesRow>
  )
}

/**
 * One tile in the session's games timeline: a finished game's number, length, and winning team,
 * opening a small menu to watch its replay or read its full summary.
 */
function GameTile({
  game,
  gameNumber,
  onWatchReplay,
  onViewGameSummary,
}: {
  game: LobbySeriesGame
  gameNumber: number
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const [anchorRef, anchorX, anchorY, refreshAnchorPos] = useRefAnchorPosition('left', 'bottom')
  const [menuOpen, openMenu, closeMenu] = usePopoverController({ refreshAnchorPos })

  return (
    <>
      <GameTileButton ref={anchorRef} type='button' onClick={openMenu}>
        <GameTileTopRow>
          <GameTileNumber>G{gameNumber}</GameTileNumber>
          <GameTileDuration>{formatGameDuration(game.durationMs)}</GameTileDuration>
        </GameTileTopRow>
        <GameTileBottomRow>
          <GameTileTrophy>
            <MaterialIcon icon='trophy' size={14} filled />
          </GameTileTrophy>
          <GameTileWinner>Team {game.winningTeamIndex + 1}</GameTileWinner>
        </GameTileBottomRow>
      </GameTileButton>
      <Popover
        open={menuOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense>
          <MenuItem
            dense
            text='Watch replay'
            onClick={() => {
              onWatchReplay(game.gameId)
              closeMenu()
            }}
          />
          <MenuItem
            dense
            text='Full summary'
            onClick={() => {
              onViewGameSummary(game.gameId)
              closeMenu()
            }}
          />
        </MenuList>
      </Popover>
    </>
  )
}

/**
 * The timeline's trailing slot: a preview of the game that would start next. Reflects the
 * countdown once the host has started one, then the load once the game itself is launching.
 */
function NextGameSlot({ nextGameNumber }: { nextGameNumber: number }) {
  const loadingState = useAppSelector(s => s.lobby.loadingState)

  if (loadingState.isCountingDown) {
    return (
      <NextSlotRoot $state='countdown'>
        <NextSlotLabel>Starting</NextSlotLabel>
        <NextSlotNumeral>{loadingState.countdownTimer}</NextSlotNumeral>
      </NextSlotRoot>
    )
  }

  if (loadingState.isLoading) {
    return (
      <NextSlotRoot $state='loading'>
        <NextSlotLabel>Starting</NextSlotLabel>
        <NextSlotValue>Game {nextGameNumber}</NextSlotValue>
      </NextSlotRoot>
    )
  }

  return (
    <NextSlotRoot $state='idle'>
      <NextSlotLabel>Next</NextSlotLabel>
      <NextSlotValue>Game {nextGameNumber}</NextSlotValue>
    </NextSlotRoot>
  )
}

/**
 * The lobby room's map banner: a full-bleed, theme-tinted crop of the map sits behind a
 * thumbnail card, the lobby's key facts, and the host's seating tools, giving the room a sense of
 * place. Below that runs a horizontal timeline of the lobby's games so far, ending in the upcoming
 * game's slot, which reflects the countdown as the lobby heads into its next game.
 */
export function RoomMapBanner({
  viewerId,
  onArrangeTeams,
  onWatchReplay,
  onViewGameSummary,
}: {
  viewerId: SbUserId
  onArrangeTeams: (arrangement: TeamArrangement) => void
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const lobby = useAppSelector(s => s.lobby.info)
  const map = lobby.map!
  const series = useAtomValue(lobbySeriesAtom)

  const isHost = lobby.host.userId === viewerId
  const playerTeamCount = lobby.teams.filter(team => !team.isObserver).length

  const mapStats: Array<[label: string, value: React.ReactNode]> = [
    ['Mode', gameTypeToLabel(lobby.gameType, t)],
    ['Size', `${map.mapData.width}×${map.mapData.height}`],
    ['Tileset', tilesetToName(map.mapData.tileset, t)],
    ['People', memberCount(lobby)],
  ]

  // The current leader gets a chip in the timeline's label row, but only while the lead is
  // unambiguous — a tie at the top names nobody.
  const wins = getWinsByUser(series)
  let leaderId: SbUserId | undefined
  let leaderWins = 0
  let leaderCount = 0
  for (const [userId, count] of wins) {
    if (count > leaderWins) {
      leaderWins = count
      leaderCount = 1
      leaderId = userId
    } else if (count === leaderWins) {
      leaderCount += 1
    }
  }
  const uniqueLeaderId = leaderCount === 1 && leaderWins > 0 ? leaderId : undefined

  const recentStartIndex = Math.max(0, series.length - 3)
  const recentGames = series
    .slice(recentStartIndex)
    .map((game, i) => ({ game, gameNumber: recentStartIndex + i + 1 }))

  const [allGamesAnchorRef, allGamesAnchorX, allGamesAnchorY, refreshAllGamesAnchorPos] =
    useRefAnchorPosition('right', 'bottom')
  const [allGamesOpen, openAllGames, closeAllGames] = usePopoverController({
    refreshAnchorPos: refreshAllGamesAnchorPos,
  })

  return (
    <BannerRoot>
      <Backdrop>
        <MapInfoImage map={map} size={1024} />
      </Backdrop>
      <TintLayer />
      <Scrim />
      <Content>
        <ThumbnailCard $aspectRatio={map.mapData.width / map.mapData.height}>
          <ReduxMapThumbnail mapId={map.id} size={512} showInfoLayer={true} />
        </ThumbnailCard>
        <InfoColumn>
          <StatsRow>
            {mapStats.map(([label, value], i) => (
              <React.Fragment key={label}>
                {i > 0 ? <StatDivider /> : null}
                <StatBlock>
                  <StatLabel>{label}</StatLabel>
                  <StatValue>{value}</StatValue>
                </StatBlock>
              </React.Fragment>
            ))}
          </StatsRow>
          {isHost && playerTeamCount > 1 ? (
            <HostTools>
              <HostToolButton
                label='Swap teams'
                iconStart={<MaterialIcon icon='swap_horiz' size={18} />}
                onClick={() => onArrangeTeams(TeamArrangement.Swap)}
              />
              <HostToolButton
                label='Shuffle'
                iconStart={<MaterialIcon icon='shuffle' size={18} />}
                onClick={() => onArrangeTeams(TeamArrangement.Shuffle)}
              />
              <HostToolButton
                label='Balance'
                iconStart={<MaterialIcon icon='balance' size={18} />}
                title='Balances teams by MMR'
                onClick={() => onArrangeTeams(TeamArrangement.Balance)}
              />
            </HostTools>
          ) : null}
          <TimelineSection>
            <TimelineLabelRow>
              <SectionLabel>Games</SectionLabel>
              {uniqueLeaderId !== undefined ? (
                <LeaderChip>
                  <LeaderAvatar userId={uniqueLeaderId} />
                  <LeaderWins>{leaderWins === 1 ? '1 win' : `${leaderWins} wins`}</LeaderWins>
                </LeaderChip>
              ) : null}
              <TimelineSpacer />
              {series.length > 0 ? (
                <AllGamesButton ref={allGamesAnchorRef} type='button' onClick={openAllGames}>
                  <span>All games</span>
                  <MaterialIcon icon='expand_more' size={16} />
                </AllGamesButton>
              ) : null}
            </TimelineLabelRow>
            <TimelineStrip>
              {series.length > 3 ? (
                <OverflowChip type='button' title='Earlier games' onClick={openAllGames}>
                  +{series.length - 3}
                </OverflowChip>
              ) : null}
              {recentGames.map(({ game, gameNumber }) => (
                <GameTile
                  key={game.gameId}
                  game={game}
                  gameNumber={gameNumber}
                  onWatchReplay={onWatchReplay}
                  onViewGameSummary={onViewGameSummary}
                />
              ))}
              <NextGameSlot nextGameNumber={series.length + 1} />
            </TimelineStrip>
            <Popover
              open={allGamesOpen}
              onDismiss={closeAllGames}
              anchorX={allGamesAnchorX ?? 0}
              anchorY={allGamesAnchorY ?? 0}
              originX='right'
              originY='top'>
              <SeriesList>
                <SeriesSection>
                  <PopoverSectionLabel>Standings</PopoverSectionLabel>
                  <LobbyScoreboard />
                </SeriesSection>
                <SeriesSection>
                  <PopoverSectionLabel>Games</PopoverSectionLabel>
                  {series.map((game, index) => (
                    <SeriesGameRow
                      key={game.gameId}
                      game={game}
                      gameNumber={index + 1}
                      onWatchReplay={onWatchReplay}
                      onViewGameSummary={onViewGameSummary}
                    />
                  ))}
                </SeriesSection>
              </SeriesList>
            </Popover>
          </TimelineSection>
        </InfoColumn>
      </Content>
    </BannerRoot>
  )
}
