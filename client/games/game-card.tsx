import { useTranslation } from 'react-i18next'
import { shallowEqual } from 'react-redux'
import styled, { css } from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameConfigPlayer, GameSource } from '../../common/games/configuration'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import {
  getResultLabel,
  ReconciledPlayerResult,
  ReconciledResult,
} from '../../common/games/results'
import { MatchmakingDivision, matchmakingDivisionToLabel } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { ConnectedAvatar } from '../avatars/avatar'
import { MaterialIcon } from '../icons/material/material-icon'
import { RaceIcon } from '../lobbies/race-icon'
import { DivisionIcon } from '../matchmaking/rank-icon'
import { Tooltip } from '../material/tooltip'
import { BackdropImage, BackdropScrim, backdropTextShadow } from '../messaging/backdrop-card'
import { useAppSelector } from '../redux-hooks'
import {
  bodySmall,
  labelMedium,
  singleLine,
  titleLarge,
  titleMedium,
  titleSmall,
} from '../styles/typography'
import { useGameDivisions } from './game-divisions'
import { getMatchupColumns } from './game-link-card'
import { GameRelativeTime } from './game-list-entry'

/** The two card sizes: regular for most shelves, large for the ones meant to stand out. */
export type GameCardSize = 'regular' | 'large'

const CARD_WIDTH: Record<GameCardSize, number> = { regular: 340, large: 456 }
const CARD_HEIGHT: Record<GameCardSize, number> = { regular: 204, large: 272 }
/** The avatar size of a lone player on a side (a 1v1), and of each player in a team column. */
const SOLO_AVATAR: Record<GameCardSize, number> = { regular: 56, large: 80 }
const TEAM_AVATAR: Record<GameCardSize, number> = { regular: 30, large: 44 }
const DIVISION_ICON: Record<GameCardSize, number> = { regular: 16, large: 24 }

export const GameCardRoot = styled.div<{
  $size: GameCardSize
  $selected: boolean
  $result?: 'win' | 'loss'
}>`
  ${backdropTextShadow};
  position: relative;
  /* Every card in a shelf has the same footprint, whatever its team size. */
  width: min(${props => CARD_WIDTH[props.$size]}px, calc(100vw - 56px));
  height: ${props => CARD_HEIGHT[props.$size]}px;
  flex-shrink: 0;
  padding: ${props => (props.$size === 'large' ? '16px 18px' : '12px 10px')};
  overflow: hidden;
  isolation: isolate;

  display: flex;
  flex-direction: column;
  gap: 12px;

  background-color: var(--theme-container-low);
  border: 1px solid
    ${props => (props.$selected ? 'var(--theme-amber)' : 'var(--theme-outline-variant)')};
  border-radius: 8px;
  box-shadow: ${props => (props.$selected ? '0 0 0 1px var(--theme-amber)' : 'none')};
  cursor: pointer;
  user-select: none;

  &:hover ${BackdropImage} {
    transform: scale(1.07);
  }

  &:hover ${BackdropScrim} {
    opacity: 0.9;
  }

  &:focus-visible {
    outline: 2px solid var(--theme-amber);
    outline-offset: 2px;
  }

  ${props =>
    props.$result
      ? css`
          &::after {
            content: '';
            position: absolute;
            left: 0;
            top: 0;
            bottom: 0;
            width: 3px;
            background: ${
              props.$result === 'win' ? 'var(--theme-positive)' : 'var(--theme-negative)'
            };
          }
        `
      : css``}
`

const CardHeader = styled.div`
  min-height: 24px;
  display: flex;
  align-items: center;
  gap: 8px;
`

const ModeLabel = styled.div<{ $size: GameCardSize }>`
  ${props => (props.$size === 'large' ? titleMedium : titleSmall)};
  ${singleLine};
  min-width: 0;
`

const LiveChip = styled.div`
  ${labelMedium};
  height: 20px;
  padding: 0 6px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;

  border-radius: 4px;
  background-color: var(--theme-live);
  color: #fff;
  font-weight: 700;
  text-shadow: none;
  text-transform: uppercase;
`

const ResultChip = styled.div<{ $result: 'win' | 'loss' }>`
  ${labelMedium};
  height: 20px;
  padding: 0 8px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;

  border-radius: 4px;
  font-weight: 700;
  text-transform: uppercase;
  color: ${props => (props.$result === 'win' ? 'var(--theme-positive)' : 'var(--theme-negative)')};
  background: color-mix(in srgb, currentColor 16%, transparent);
`

const Face = styled.div<{ $teams: boolean }>`
  flex-grow: 1;
  min-height: 0;

  display: grid;
  grid-template-columns: ${props =>
    props.$teams ? 'minmax(0, 1fr) 1px minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)'};
  align-items: center;
  gap: ${props => (props.$teams ? '8px' : '12px')};
`

/** The line between two teams. */
const TeamDivider = styled.div`
  align-self: stretch;
  background-color: rgb(from var(--theme-on-surface-variant) r g b / 0.24);
`

const SoloSide = styled.div`
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
`

const NameRow = styled.div`
  max-width: 100%;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
`

const SoloName = styled.div<{ $size: GameCardSize }>`
  ${props => (props.$size === 'large' ? titleLarge : titleMedium)};
  ${singleLine};
  min-width: 0;
`

/** A team: one player per line, mirrored on the first side so both teams' avatars face the middle. */
const TeamColumn = styled.div<{ $mirrored: boolean; $size: GameCardSize }>`
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: ${props => (props.$mirrored ? 'flex-end' : 'flex-start')};
  gap: ${props => (props.$size === 'large' ? '10px' : '6px')};
`

const TeamPlayerRow = styled.div<{ $mirrored: boolean; $size: GameCardSize }>`
  max-width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: ${props => (props.$mirrored ? 'row-reverse' : 'row')};
  align-items: center;
  gap: ${props => (props.$size === 'large' ? '6px' : '4px')};
`

/**
 * A regular card's team column has about 150px for a player's avatar, rank and name, so names are
 * set a pixel smaller than `titleSmall` to fit 12-character names without truncating.
 */
const TeamName = styled.div<{ $size: GameCardSize }>`
  ${props =>
    props.$size === 'large'
      ? titleMedium
      : css`
          ${titleSmall};
          font-size: 15px;
          letter-spacing: 0.2px;
        `};
  ${singleLine};
  min-width: 0;
`

const AvatarWithRace = styled.div`
  position: relative;
  flex-shrink: 0;
  display: flex;
`

const RaceBadge = styled.div<{ $avatarSize: number }>`
  position: absolute;
  right: ${props => -Math.round(props.$avatarSize / 10)}px;
  bottom: -3px;
  width: ${props => Math.max(16, Math.round(props.$avatarSize * 0.4))}px;
  height: ${props => Math.max(16, Math.round(props.$avatarSize * 0.4))}px;

  display: grid;
  place-items: center;

  border-radius: 50%;
  background-color: var(--theme-container-low);

  & > svg {
    width: 70%;
    height: 70%;
  }
`

const Footer = styled.div`
  ${bodySmall};
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--theme-on-surface-variant);
`

const FooterMap = styled.div`
  ${labelMedium};
  ${singleLine};
  min-width: 0;
  color: var(--theme-on-surface);
`

const FooterMeta = styled.div`
  margin-left: auto;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
`

const FooterLength = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 2px;
  color: var(--theme-on-surface);
  font-variant-numeric: tabular-nums;
`

const SizedAvatar = styled(ConnectedAvatar)<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

const ComputerAvatarSpace = styled.div<{ $size: number }>`
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
  border-radius: 50%;
  background-color: var(--theme-container-high);
`

const DivisionTooltip = styled(Tooltip)`
  flex-shrink: 0;
  display: flex;
`

const DivisionBadge = styled(DivisionIcon)<{ $size: number }>`
  flex-shrink: 0;
  width: ${props => props.$size}px;
  height: ${props => props.$size}px;
`

/** One player as a card shows them. */
export interface GameCardPlayer {
  /** Absent for computer players, which have no account (and so no avatar or rank). */
  userId?: SbUserId
  name: string
  race: RaceChar
  division?: MatchmakingDivision
}

function PlayerAvatar({ player, size }: { player: GameCardPlayer; size: number }) {
  return (
    <AvatarWithRace>
      {player.userId !== undefined ? (
        <SizedAvatar userId={player.userId} showLiveIndicator={false} $size={size} />
      ) : (
        <ComputerAvatarSpace $size={size} />
      )}
      <RaceBadge $avatarSize={size}>
        <RaceIcon race={player.race} />
      </RaceBadge>
    </AvatarWithRace>
  )
}

function PlayerDivision({ division, size }: { division?: MatchmakingDivision; size: number }) {
  const { t } = useTranslation()
  if (division === undefined) {
    return null
  }
  return (
    <DivisionTooltip text={matchmakingDivisionToLabel(division, t)} position='top' tabIndex={-1}>
      <DivisionBadge division={division} size={size} $size={size} />
    </DivisionTooltip>
  )
}

export interface GameCardLayoutProps {
  size: GameCardSize
  mapImageUrl: string | undefined
  mapName: string
  modeLabel: string
  live?: boolean
  /** The viewer's result, shown as a chip and an edge in their own games. */
  result?: 'win' | 'loss'
  /** The two sides, the first drawn on the left. */
  sides: ReadonlyArray<ReadonlyArray<GameCardPlayer>>
  /** The game's length (or, while live, how long it has run), already formatted. */
  lengthText?: string
  /** When the game started, for the relative time in the footer. Omitted for live games. */
  startTime?: number
  selected?: boolean
  onClick?: (event: React.MouseEvent) => void
  onDoubleClick?: (event: React.MouseEvent) => void
  onContextMenu?: (event: React.MouseEvent) => void
  actionLabel?: string
  className?: string
}

/**
 * A game as a card: the players facing each other over a shaded picture of the map, the mode up
 * top, and the map, length and time along the bottom. A 1v1 shows each player large; a team game
 * lists every player in a column per team. Data-free, so it backs both finished and live games.
 */
export function GameCardLayout({
  size,
  mapImageUrl,
  mapName,
  modeLabel,
  live,
  result,
  sides,
  lengthText,
  startTime,
  selected = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  actionLabel,
  className,
}: GameCardLayoutProps) {
  const { t } = useTranslation()
  const teams = sides.some(side => side.length > 1)

  const renderSide = (side: ReadonlyArray<GameCardPlayer>, index: number) => {
    if (!teams) {
      const player = side[0]
      if (!player) {
        return <SoloSide key={index} />
      }
      return (
        <SoloSide key={index}>
          <PlayerAvatar player={player} size={SOLO_AVATAR[size]} />
          <NameRow>
            <PlayerDivision division={player.division} size={DIVISION_ICON[size] + 2} />
            <SoloName $size={size}>{player.name}</SoloName>
          </NameRow>
        </SoloSide>
      )
    }

    const mirrored = index === 0
    return (
      <TeamColumn key={index} $mirrored={mirrored} $size={size}>
        {side.map((player, i) => (
          <TeamPlayerRow key={i} $mirrored={mirrored} $size={size}>
            <PlayerAvatar player={player} size={TEAM_AVATAR[size]} />
            <PlayerDivision division={player.division} size={DIVISION_ICON[size]} />
            <TeamName $size={size}>{player.name}</TeamName>
          </TeamPlayerRow>
        ))}
      </TeamColumn>
    )
  }

  return (
    <GameCardRoot
      className={className}
      $size={size}
      $selected={selected}
      $result={result}
      role='button'
      tabIndex={0}
      aria-label={actionLabel}
      aria-pressed={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick?.(event as unknown as React.MouseEvent)
        }
      }}>
      {mapImageUrl ? <BackdropImage src={mapImageUrl} alt='' draggable={false} /> : null}
      <BackdropScrim />
      <CardHeader>
        {live ? <LiveChip>{t('games.card.live', 'Live')}</LiveChip> : null}
        {result ? <ResultChip $result={result}>{getResultLabel(result, t)}</ResultChip> : null}
        <ModeLabel $size={size}>{modeLabel}</ModeLabel>
      </CardHeader>
      <Face $teams={teams}>
        {renderSide(sides[0] ?? [], 0)}
        {teams ? <TeamDivider /> : null}
        {renderSide(sides[1] ?? [], 1)}
      </Face>
      <Footer>
        <FooterMap>{mapName}</FooterMap>
        <FooterMeta>
          {lengthText ? (
            <FooterLength>
              <MaterialIcon icon='timer' size={14} />
              {lengthText}
            </FooterLength>
          ) : null}
          {lengthText && startTime !== undefined ? <span>·</span> : null}
          {startTime !== undefined ? <GameRelativeTime timestampMs={startTime} /> : null}
        </FooterMeta>
      </Footer>
    </GameCardRoot>
  )
}

/** Returns the viewer's own result in a game, or undefined if they didn't play or it's unknown. */
export function getResultFor(
  game: ReadonlyDeep<GameRecordJson>,
  userId: SbUserId | undefined,
): 'win' | 'loss' | undefined {
  if (userId === undefined || !Array.isArray(game.results)) {
    return undefined
  }
  const entry = game.results.find(([id]) => id === userId)
  const result: ReconciledResult | undefined = entry?.[1].result
  return result === 'win' || result === 'loss' ? result : undefined
}

export interface GameRecordCardProps {
  gameId: string
  size: GameCardSize
  /** Whose games these are: their side is drawn first and their result shown. */
  forUserId?: SbUserId
  spoilerFree: boolean
  selected?: boolean
  onSelect?: (gameId: string) => void
  onOpen?: (gameId: string) => void
  onContextMenu?: (gameId: string, event: React.MouseEvent) => void
}

/** A card for a finished game, read from the store. */
export function GameRecordCard({
  gameId,
  size,
  forUserId,
  spoilerFree,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: GameRecordCardProps) {
  const { t } = useTranslation()
  const game = useAppSelector(s => s.games.byId.get(gameId))
  const map = useAppSelector(s => (game ? s.maps.byId.get(game.mapId) : undefined))
  const players = game?.config.teams.flat() ?? []
  // Index-aligned with `players`, so the card rerenders only when one of its own players' names
  // changes.
  const names = useAppSelector(
    s => players.map(p => (p.isComputer ? undefined : s.users.byId.get(p.id)?.name)),
    shallowEqual,
  )
  const divisionById = useGameDivisions(game)

  if (!game) {
    return null
  }

  const nameById = new Map(players.map((p, i) => [p.id, names[i]]))
  const getName = (player: ReadonlyDeep<GameConfigPlayer>) =>
    player.isComputer
      ? t('game.playerName.computer', 'Computer')
      : (nameById.get(player.id) ?? t('game.playerName.unknown', 'Unknown player'))
  // Legacy rows can hold a non-array `results`; the explicit types keep `Array.isArray` from
  // widening the entries.
  const resultsById = new Map<SbUserId, ReconciledPlayerResult>(
    Array.isArray(game.results) ? game.results : [],
  )

  let columns = getMatchupColumns(game, getName)
  if (forUserId !== undefined && columns[1]?.some(p => p.id === forUserId)) {
    columns = [columns[1], columns[0]]
  }
  const sides = columns.map(column =>
    column.map((player): GameCardPlayer => ({
      userId: player.isComputer ? undefined : player.id,
      name: getName(player),
      race: resultsById.get(player.id)?.race ?? player.race,
      division: player.isComputer ? undefined : divisionById?.get(player.id),
    })),
  )

  const result = spoilerFree ? undefined : getResultFor(game, forUserId)
  const lengthText =
    spoilerFree || !game.gameLength ? undefined : getGameDurationString(game.gameLength)
  const modeLabel =
    game.config.gameSource === GameSource.Matchmaking
      ? getGameTypeLabel(game, t)
      : t('game.gameSource.custom', 'Custom game')

  return (
    <GameCardLayout
      size={size}
      mapImageUrl={size === 'large' ? (map?.image512Url ?? map?.image256Url) : map?.image256Url}
      mapName={map?.name ?? t('game.mapName.unknown', 'Unknown map')}
      modeLabel={modeLabel}
      result={result}
      sides={sides}
      lengthText={lengthText}
      startTime={game.startTime}
      selected={selected}
      actionLabel={t('games.card.select', 'Show this game')}
      onClick={() => onSelect?.(game.id)}
      onDoubleClick={() => onOpen?.(game.id)}
      onContextMenu={event => {
        if (onContextMenu) {
          event.preventDefault()
          onContextMenu(game.id, event)
        }
      }}
    />
  )
}
