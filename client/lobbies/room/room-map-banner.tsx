import { TFunction } from 'i18next'
import * as React from 'react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css, keyframes } from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameType, gameTypeToLabel, isTeamType } from '../../../common/games/game-type'
import { getGameDurationString } from '../../../common/games/games'
import { getLobbySlots, hasControlledOpens, isUms, Lobby, slotCount } from '../../../common/lobbies'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { findSeriesGameWinner, LobbySeriesWinner } from '../../../common/lobbies/lobby-series'
import { SlotType } from '../../../common/lobbies/slot'
import { tilesetToName } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { MaterialIcon } from '../../icons/material/material-icon'
import { batchGetMapInfo } from '../../maps/action-creators'
import { MapInfoImage } from '../../maps/map-image'
import { ReduxMapThumbnail } from '../../maps/map-thumbnail'
import { IconButton, TextButton } from '../../material/button'
import { buttonReset } from '../../material/button-reset'
import { MenuItem } from '../../material/menu/item'
import { MenuList } from '../../material/menu/menu'
import { Popover } from '../../material/popover'
import { Tooltip } from '../../material/tooltip'
import { useAppDispatch, useAppSelector } from '../../redux-hooks'
import {
  bodyMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleMedium,
} from '../../styles/typography'
import { getBatchUserInfo } from '../../users/action-creators'
import { LobbyScoreboard } from './lobby-scoreboard'
import {
  lobbyTeamLabel,
  SectionLabel,
  TeamArrangement,
  useAnchoredMenu,
  useLobbyLifecycle,
} from './room-parts'

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

/**
 * Wraps rather than squeezing: six stats and their dividers outgrow the column beside the
 * thumbnail, and a stat truncated to its first letters reads as nothing.
 */
const StatsRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 20px;
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

const GameTileUnresolved = styled(GameTileWinner)`
  color: var(--theme-on-surface-variant);
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

const NextSlotRoot = styled.div<{ $state: 'idle' | 'countdown' | 'loading' | 'playing' }>`
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

/**
 * Names whoever won a finished game, or `undefined` when there is nobody to name: the winning side
 * in the lobby's own team labels, or the winning player in a game played as a single side, where no
 * team took anything.
 *
 * A lobby's earlier games can name people who have since left it, whom nothing else in the room has
 * any reason to have loaded, so the winner's name is fetched on demand.
 */
function useWinnerLabel(winner: LobbySeriesWinner | undefined): string | undefined {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const winnerUserId = winner?.kind === 'player' ? winner.userId : undefined
  const winnerName = useAppSelector(s =>
    winnerUserId !== undefined ? s.users.byId.get(winnerUserId)?.name : undefined,
  )

  useEffect(() => {
    if (winnerUserId !== undefined) {
      dispatch(getBatchUserInfo(winnerUserId))
    }
  }, [dispatch, winnerUserId])

  if (winner === undefined) {
    return undefined
  }
  return winner.kind === 'team' ? lobbyTeamLabel(winner, t) : (winnerName ?? '…')
}

/** One finished game from the lobby's games so far: what was played, who took it, and how to revisit it. */
function SeriesGameRow({
  game,
  gameNumber,
  onWatchReplay,
  onViewGameSummary,
}: {
  game: LobbySeriesGameJson
  gameNumber: number
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const dispatch = useAppDispatch()
  const mapName = useAppSelector(s => s.maps.byId.get(game.mapId)?.name)

  // A lobby's earlier games can be on maps it has since moved off of, which nothing else here has
  // any reason to have loaded.
  useEffect(() => {
    dispatch(batchGetMapInfo(game.mapId))
  }, [dispatch, game.mapId])

  const winnerLabel = useWinnerLabel(findSeriesGameWinner(game))

  return (
    <SeriesRow>
      <SeriesGameNumber>
        {t('lobbies.room.series.gameNumberShort', 'G{{number}}', { number: gameNumber })}
      </SeriesGameNumber>
      <SeriesMain>
        <SeriesMapName title={mapName}>
          {mapName ?? t('lobbies.room.series.unknownMap', 'unknown map')}
        </SeriesMapName>
        <SeriesFactRow>
          {winnerLabel !== undefined ? (
            <>
              <SeriesTrophyIcon icon='trophy' size={14} filled />
              <SeriesWinner>{winnerLabel}</SeriesWinner>
            </>
          ) : (
            <SeriesWinner>
              {game.result
                ? t('lobbies.room.series.noRecordedWinner', 'No recorded winner')
                : t('lobbies.room.series.waitingForResults', 'Waiting for results')}
            </SeriesWinner>
          )}
          {game.result ? (
            <>
              <SeriesFactDivider>·</SeriesFactDivider>
              <SeriesDuration>{getGameDurationString(game.result.durationMs)}</SeriesDuration>
            </>
          ) : null}
        </SeriesFactRow>
      </SeriesMain>
      <SeriesAction
        icon={<MaterialIcon icon='play_arrow' />}
        title={t('lobbies.room.series.watchReplay', 'Watch replay')}
        onClick={() => onWatchReplay(game.gameId)}
      />
      <SeriesAction
        icon={<MaterialIcon icon='summarize' />}
        title={t('lobbies.room.series.fullSummary', 'Full summary')}
        onClick={() => onViewGameSummary(game.gameId)}
      />
    </SeriesRow>
  )
}

/**
 * One tile in the session's games timeline: a finished game's number, length, and who took it,
 * opening a small menu to watch its replay or read its full summary.
 */
function GameTile({
  game,
  gameNumber,
  onWatchReplay,
  onViewGameSummary,
}: {
  game: LobbySeriesGameJson
  gameNumber: number
  onWatchReplay: (gameId: string) => void
  onViewGameSummary: (gameId: string) => void
}) {
  const { t } = useTranslation()
  const { anchorRef, anchorX, anchorY, isOpen, openMenu, closeMenu } =
    useAnchoredMenu<HTMLButtonElement>('left', 'bottom')

  const winnerLabel = useWinnerLabel(findSeriesGameWinner(game))

  return (
    <>
      <GameTileButton
        ref={anchorRef}
        type='button'
        aria-haspopup='menu'
        aria-expanded={isOpen}
        onClick={openMenu}>
        <GameTileTopRow>
          <GameTileNumber>
            {t('lobbies.room.series.gameNumberShort', 'G{{number}}', { number: gameNumber })}
          </GameTileNumber>
          {game.result ? (
            <GameTileDuration>{getGameDurationString(game.result.durationMs)}</GameTileDuration>
          ) : null}
        </GameTileTopRow>
        <GameTileBottomRow>
          {winnerLabel !== undefined ? (
            <>
              <GameTileTrophy>
                <MaterialIcon icon='trophy' size={14} filled />
              </GameTileTrophy>
              <GameTileWinner>{winnerLabel}</GameTileWinner>
            </>
          ) : (
            <GameTileUnresolved>
              {game.result
                ? t('lobbies.room.series.tileNoWinner', 'No winner')
                : t('lobbies.room.series.tilePending', 'Pending')}
            </GameTileUnresolved>
          )}
        </GameTileBottomRow>
      </GameTileButton>
      <Popover
        open={isOpen}
        onDismiss={closeMenu}
        anchorX={anchorX ?? 0}
        anchorY={anchorY ?? 0}
        originX='left'
        originY='top'>
        <MenuList dense>
          <MenuItem
            dense
            text={t('lobbies.room.series.watchReplay', 'Watch replay')}
            onClick={() => {
              onWatchReplay(game.gameId)
              closeMenu()
            }}
          />
          <MenuItem
            dense
            text={t('lobbies.room.series.fullSummary', 'Full summary')}
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
 * The timeline's trailing slot: the game the lobby is headed into. It counts down once the host has
 * started one, follows the load as the game launches, and stands in for the game while it runs,
 * becoming a preview of the next one again as soon as the lobby regroups.
 */
function NextGameSlot({ nextGameNumber }: { nextGameNumber: number }) {
  const { t } = useTranslation()
  const lifecycle = useLobbyLifecycle()
  const countdownTimer = useAppSelector(s => s.lobby.loadingState.countdownTimer)
  const gameLabel = t('lobbies.room.series.gameNumber', 'Game {{number}}', {
    number: nextGameNumber,
  })

  switch (lifecycle) {
    case 'countingDown':
      return (
        <NextSlotRoot $state='countdown'>
          <NextSlotLabel>{t('lobbies.room.series.starting', 'Starting')}</NextSlotLabel>
          <NextSlotNumeral>{countdownTimer}</NextSlotNumeral>
        </NextSlotRoot>
      )
    case 'loading':
      return (
        <NextSlotRoot $state='loading'>
          <NextSlotLabel>{t('lobbies.room.series.starting', 'Starting')}</NextSlotLabel>
          <NextSlotValue>{gameLabel}</NextSlotValue>
        </NextSlotRoot>
      )
    case 'inGame':
      return (
        <NextSlotRoot $state='playing'>
          <NextSlotLabel>{t('lobbies.room.series.playing', 'Playing')}</NextSlotLabel>
          <NextSlotValue>{gameLabel}</NextSlotValue>
        </NextSlotRoot>
      )
    case 'gathering':
      return (
        <NextSlotRoot $state='idle'>
          <NextSlotLabel>{t('lobbies.room.series.next', 'Next')}</NextSlotLabel>
          <NextSlotValue>{gameLabel}</NextSlotValue>
        </NextSlotRoot>
      )
    default:
      return assertUnreachable(lifecycle)
  }
}

/** A label for the way a lobby's seats are split up, e.g. "3 vs 5" or "3 teams". */
function gameSubTypeLabel(lobby: Lobby, t: TFunction): string {
  if (lobby.gameType === GameType.TopVsBottom) {
    return t('lobbies.createLobby.gameSubTypeOptionTvB', {
      defaultValue: '{{topSlots}} vs {{bottomSlots}}',
      topSlots: lobby.gameSubType,
      bottomSlots: slotCount(lobby) - lobby.gameSubType,
    })
  }

  return t('lobbies.createLobby.gameSubTypeOption', {
    defaultValue: '{{numTeams}} teams',
    numTeams: lobby.gameSubType,
  })
}

/**
 * The lobby room's map banner: a full-bleed, theme-tinted crop of the map sits behind a
 * thumbnail card, the lobby's key facts, and the host's seating tools, giving the room a sense of
 * place. Below that runs a horizontal timeline of the lobby's games so far, ending in a slot for the
 * game it is headed into, which follows that game from the countdown through to its finish.
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
  const series = useAppSelector(s => s.lobby.series)
  const lifecycle = useLobbyLifecycle()

  const isHost = lobby.host.userId === viewerId
  const playerTeams = lobby.teams.filter(team => !team.isObserver)
  // Trading two teams' occupants only means anything between two equally sized sides, and a UMS
  // lobby's teams are the map's own forces, which cannot trade places at all. Shuffling needs teams
  // to deal between, and in game types where a computer takes a whole team rather than a seat of
  // its own, there is no seat to deal it into.
  const canSwap =
    !isUms(lobby.gameType) &&
    playerTeams.length === 2 &&
    playerTeams[0].slots.length === playerTeams[1].slots.length
  const canShuffle = playerTeams.length >= 2
  const shuffleBlockedByComputers =
    hasControlledOpens(lobby.gameType) &&
    getLobbySlots(lobby).some(slot => slot.type === SlotType.Computer)
  // Only a gathering lobby's layout can be rearranged; from the countdown until the game ends its
  // seats are what the game was configured with.
  const showHostTools = isHost && lifecycle === 'gathering' && (canSwap || canShuffle)

  const mapStats: Array<[label: string, value: React.ReactNode]> = [
    [t('lobbies.room.banner.statMode', 'Mode'), gameTypeToLabel(lobby.gameType, t)],
  ]
  if (isTeamType(lobby.gameType)) {
    mapStats.push([t('lobbies.lobby.gameSubType', 'Teams'), gameSubTypeLabel(lobby, t)])
  }
  mapStats.push(
    [t('lobbies.room.banner.statSize', 'Size'), `${map.mapData.width}×${map.mapData.height}`],
    [t('lobbies.room.banner.statTileset', 'Tileset'), tilesetToName(map.mapData.tileset, t)],
    [
      t('lobbies.lobby.unitLimit', 'Unit limit'),
      lobby.useLegacyLimits
        ? t('lobbies.lobby.unitLimitLegacy', 'Legacy')
        : t('lobbies.lobby.unitLimitExtended', 'Extended'),
    ],
    [
      t('lobbies.summary.slotsLabel', 'Slots'),
      isUms(lobby.gameType) ? map.mapData.umsSlots : map.mapData.slots,
    ],
  )

  const recentStartIndex = Math.max(0, series.length - 3)
  const recentGames = series
    .slice(recentStartIndex)
    .map((game, i) => ({ game, gameNumber: recentStartIndex + i + 1 }))

  const {
    anchorRef: allGamesAnchorRef,
    anchorX: allGamesAnchorX,
    anchorY: allGamesAnchorY,
    isOpen: allGamesOpen,
    openMenu: openAllGames,
    closeMenu: closeAllGames,
  } = useAnchoredMenu<HTMLButtonElement>('right', 'bottom')

  let shuffleTool: React.ReactNode = null
  if (canShuffle) {
    const shuffleButton = (
      <HostToolButton
        label={t('lobbies.room.banner.shuffle', 'Shuffle')}
        iconStart={<MaterialIcon icon='shuffle' size={18} />}
        disabled={shuffleBlockedByComputers}
        onClick={() => onArrangeTeams(TeamArrangement.Shuffle)}
      />
    )
    shuffleTool = shuffleBlockedByComputers ? (
      <Tooltip
        text={t(
          'lobbies.room.banner.shuffleBlockedByComputers',
          'Remove the computers to shuffle',
        )}>
        {shuffleButton}
      </Tooltip>
    ) : (
      shuffleButton
    )
  }

  return (
    <BannerRoot>
      <Backdrop>
        {/* Decorative: the map is named and shown for real in the thumbnail card alongside it. */}
        <MapInfoImage map={map} size={512} altText='' />
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
          {showHostTools ? (
            <HostTools>
              {canSwap ? (
                <HostToolButton
                  label={t('lobbies.room.banner.swapTeams', 'Swap teams')}
                  iconStart={<MaterialIcon icon='swap_horiz' size={18} />}
                  onClick={() => onArrangeTeams(TeamArrangement.Swap)}
                />
              ) : null}
              {shuffleTool}
            </HostTools>
          ) : null}
          <TimelineSection>
            <TimelineLabelRow>
              <SectionLabel>{t('lobbies.room.series.gamesLabel', 'Games')}</SectionLabel>
              <TimelineSpacer />
              {series.length > 0 ? (
                <AllGamesButton
                  ref={allGamesAnchorRef}
                  type='button'
                  aria-haspopup='dialog'
                  aria-expanded={allGamesOpen}
                  onClick={openAllGames}>
                  <span>{t('lobbies.room.series.allGames', 'All games')}</span>
                  <MaterialIcon icon='expand_more' size={16} />
                </AllGamesButton>
              ) : null}
            </TimelineLabelRow>
            <TimelineStrip>
              {series.length > 3 ? (
                <OverflowChip
                  type='button'
                  title={t('lobbies.room.series.earlierGames', 'Earlier games')}
                  aria-haspopup='dialog'
                  aria-expanded={allGamesOpen}
                  onClick={openAllGames}>
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
                  <PopoverSectionLabel>
                    {t('lobbies.room.series.standings', 'Standings')}
                  </PopoverSectionLabel>
                  <LobbyScoreboard />
                </SeriesSection>
                <SeriesSection>
                  <PopoverSectionLabel>
                    {t('lobbies.room.series.gamesLabel', 'Games')}
                  </PopoverSectionLabel>
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
