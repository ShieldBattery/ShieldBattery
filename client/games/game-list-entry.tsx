import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import { getResultLabel, ReconciledResult } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user-id'
import { longTimestamp, narrowDuration } from '../i18n/date-formats'
import { ButtonStateStyleProps, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { Tooltip } from '../material/tooltip'
import { useCurrentMinuteMs } from '../react/date-hooks'
import { useAppSelector } from '../redux-hooks'
import { bodyMedium, singleLine, titleMedium, titleSmall } from '../styles/typography'
import { GamePlayersDisplay, getOrderedTeams, useGamePlayerNames } from './game-players-display'

// The row's cells respond to the `game-list-rows` container established around the scrolling list
// in `GameListView` and the replay library (its inline size tracks the actual row width, unlike
// the page width, which also has to fit the side detail panel). Thresholds come from the cells'
// widths (players' 328px basis, duration's fixed 96px, map's 196px, this file's own 100px time
// column, the 96px leading cell when present, gaps, and row padding).
/** Row width below which the relative-time cell is dropped first. */
const HIDE_RELATIVE_TIME_BELOW_PX = 880
/** Row width below which the map + game type cell is also dropped, to stop clipping. */
const HIDE_MAP_AND_GAME_TYPE_BELOW_PX = 640

const GameListEntryRoot = styled.div<{ $hasLeadingAction?: boolean }>`
  width: 100%;
  /*
    Keeps a single-team (e.g. 1v1) row from collapsing to nothing; taller multi-team rows exceed it
    and drive their own height, so team matchups still read as taller.
  */
  min-height: 52px;
  padding: 8px 16px;
  /*
    The leading action cell (e.g. a bookmark toggle) already provides breathing room, so the row's
    own left padding shrinks to keep the icon optically aligned with content above/below.
  */
  padding-left: ${props => (props.$hasLeadingAction ? '6px' : '16px')};

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
`

const BaseCell = styled.div`
  height: 100%;
  flex-grow: 0;
  flex-shrink: 1;
  flex-basis: auto;
`

/**
 * A fixed-width, non-growing column reserved for a single leading action (e.g. a replay's star /
 * bookmark toggle), kept narrow so it reads as its own column rather than sharing the leading cell.
 */
const BookmarkCell = styled.div`
  flex: 0 0 auto;
  width: 48px;
  height: 100%;

  display: flex;
  align-items: center;
  justify-content: center;
`

const LeadingCell = styled(BaseCell)`
  width: 96px;

  display: flex;
  flex-direction: column;
  align-items: flex-start;
`

const PlayersCell = styled(BaseCell)`
  width: 328px;
  flex-grow: 1;

  & > * {
    /*
     * Caps the team columns' spread: in a wide row the players cell absorbs all the slack, and
     * without a cap the evenly-split team columns would push the second team toward the middle
     * of the row, far from the first. The cap keeps opposing teams reading as one matchup and
     * gives the second column a stable position to scan down the list.
     */
    max-width: 480px;
  }
`

const RelativeTimeCell = styled(BaseCell)`
  ${bodyMedium};
  ${singleLine};
  width: 100px;
  flex-shrink: 0;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  text-align: right;

  color: var(--theme-on-surface-variant);

  @container game-list-rows (width < ${HIDE_RELATIVE_TIME_BELOW_PX}px) {
    display: none;
  }
`

const GameLengthCell = styled(BaseCell)`
  ${titleMedium};
  font-variant-numeric: tabular-nums;
  width: 96px;
  /*
    The duration is the one cell that must never truncate — narrow rows collapse the map cell and
    squeeze player names instead.
  */
  flex-shrink: 0;

  display: flex;
  justify-content: flex-end;
`

const MapAndGameTypeCell = styled(BaseCell)`
  width: 196px;
  min-width: 0;

  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;

  @container game-list-rows (width < ${HIDE_MAP_AND_GAME_TYPE_BELOW_PX}px) {
    display: none;
  }
`

const GameListEntryResult = styled.div<{ $result: ReconciledResult }>`
  ${titleMedium};
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
  flex-shrink: 0;
`

const MapNameAndGameTypeContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  min-width: 0;
`

const MapName = styled.div`
  ${titleSmall};
  ${singleLine};

  min-width: 0;
  width: 100%;
  text-align: right;
`

const GameType = styled.div`
  ${bodyMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);

  min-width: 0;
  width: 100%;
  text-align: right;
`

export interface GameListEntryLayoutProps {
  /**
   * Content of a narrow, dedicated leading action column (e.g. a replay's star / bookmark toggle).
   * When omitted, the column isn't rendered.
   */
  bookmark?: React.ReactNode
  /**
   * Content of the leading cell (e.g. a match result label). When omitted, the cell isn't
   * rendered.
   */
  leading?: React.ReactNode
  /** Content of the players cell (a players/teams display). */
  players: React.ReactNode
  /**
   * Content of the relative-time cell (e.g. a `GameRelativeTime`), shown between the players and
   * duration cells. Pass an empty node rather than omitting it to keep the column's width reserved
   * for a row with nothing to show (e.g. an unparseable replay).
   */
  relativeTime?: React.ReactNode
  /** Preformatted game duration text (e.g. `12:34`, or `—` when unknown). */
  duration: string
  /** Map name text (already color-code-stripped). */
  mapName: string
  /** Game type / mode label. */
  gameTypeLabel: string
  className?: string
  /** Extra content rendered inside the row root after the cells (e.g. a `Ripple`). */
  children?: React.ReactNode
}

/**
 * The purely presentational layout for a game/replay list row: the row root plus its cells (an
 * optional bookmark column and leading cell, then players, duration, and map + game type). Carries
 * no data dependencies so it can back both real games (see `GameListEntry`) and local replay files.
 */
export function GameListEntryLayout({
  bookmark,
  leading,
  players,
  relativeTime,
  duration,
  mapName,
  gameTypeLabel,
  className,
  children,
}: GameListEntryLayoutProps) {
  return (
    <GameListEntryRoot className={className} $hasLeadingAction={bookmark !== undefined}>
      {bookmark !== undefined ? <BookmarkCell>{bookmark}</BookmarkCell> : null}

      {leading !== undefined ? <LeadingCell>{leading}</LeadingCell> : null}

      <PlayersCell>{players}</PlayersCell>

      {relativeTime !== undefined ? <RelativeTimeCell>{relativeTime}</RelativeTimeCell> : null}

      <GameLengthCell>{duration}</GameLengthCell>

      <MapAndGameTypeCell>
        <MapNameAndGameTypeContainer>
          <MapName title={mapName}>{mapName}</MapName>
          <GameType>{gameTypeLabel}</GameType>
        </MapNameAndGameTypeContainer>
      </MapAndGameTypeCell>

      {children}
    </GameListEntryRoot>
  )
}

export interface GameRelativeTimeProps {
  /** Unix ms when the game/replay started. */
  timestampMs: number
  className?: string
}

/**
 * A game/replay row's relative-time cell content: a narrow label (e.g. "18h ago") that refreshes
 * as real time crosses each minute boundary, backed by the shared minute clock rather than a timer
 * of its own. Hovering reveals the absolute date and time.
 */
export function GameRelativeTime({ timestampMs, className }: GameRelativeTimeProps) {
  const { t } = useTranslation()
  const currentMinuteMs = useCurrentMinuteMs()

  // Intl's relative-time units bottom out at seconds, which reads as false precision when the
  // display itself only ever refreshes once a minute.
  const label =
    currentMinuteMs - timestampMs < 60_000
      ? t('game.time.justNow', 'Just now')
      : narrowDuration.format(timestampMs, currentMinuteMs)

  return (
    <Tooltip text={longTimestamp.format(timestampMs)} className={className}>
      {label}
    </Tooltip>
  )
}

/**
 * A selectable row container matching the replay library's row, for pages that let a game row be
 * clicked to show its details in a side panel rather than navigating straight to its results page.
 */
export const SelectableRowContainer = styled.div<ButtonStateStyleProps & { $selected: boolean }>`
  position: relative;
  width: 100%;

  border-radius: 8px;
  contain: content;
  cursor: pointer;

  background-color: ${props =>
    props.$selected ? 'rgb(from var(--theme-on-surface) r g b / 0.1)' : 'transparent'};

  &:hover {
    background-color: ${props =>
      props.$selected
        ? 'rgb(from var(--theme-on-surface) r g b / 0.12)'
        : 'rgb(from var(--theme-on-surface) r g b / 0.06)'};
  }
`

export interface GameListEntryProps {
  game: ReadonlyDeep<GameRecordJson>
  showResult?: boolean
  forUserId?: SbUserId
  /**
   * Hides the game length and, when results are shown, the match result — both spoilers for
   * someone rewatching their games.
   */
  spoilerFree?: boolean
  /** Shows the row in its selected state. */
  selected?: boolean
  onClick?: (gameId: string) => void
  onDoubleClick?: (gameId: string) => void
  onContextMenu?: (gameId: string, event: React.MouseEvent) => void
  ref?: React.Ref<HTMLDivElement>
}

export function GameListEntry({
  game,
  showResult = false,
  forUserId,
  spoilerFree = false,
  selected = false,
  onClick,
  onDoubleClick,
  onContextMenu,
  ref,
}: GameListEntryProps) {
  const { t } = useTranslation()
  const map = useAppSelector(s => s.maps.byId.get(game.mapId))
  const nameById = useGamePlayerNames(game)

  const [buttonProps, rippleRef] = useButtonState({
    onClick: onClick ? () => onClick(game.id) : undefined,
    onDoubleClick: onDoubleClick ? () => onDoubleClick(game.id) : undefined,
  })

  const { results } = game

  // The side the result label refers to: `forUserId`'s side when one was given, otherwise
  // whichever side `GamePlayersDisplay` lists first for this row — sharing its ordering logic
  // keeps the label and the rendered player order from ever disagreeing. Outside of topVBottom,
  // the two displayed columns are an alphabetical split of all players rather than real teams, so
  // only the single first-listed player can honestly be labeled with one result. Left empty
  // (rather than computed) when the result isn't even shown.
  const orderedTeams = showResult
    ? getOrderedTeams(game.config.teams, game.config.gameType, nameById, forUserId)
    : []
  const firstSide =
    game.config.gameType === 'topVBottom'
      ? (orderedTeams[0] ?? [])
      : (orderedTeams[0]?.slice(0, 1) ?? [])

  // NOTE(2Pac): No need to memoize this under react-compiler; it re-derives only when its inputs
  // change.
  let result: ReconciledResult = 'unknown'
  if (results) {
    if (forUserId) {
      for (const [userId, r] of results) {
        if (userId === forUserId) {
          result = r.result
          break
        }
      }
    } else {
      // Team members' results agree in practice, so the first member with a reported entry is
      // enough. A no-op loop over an empty `firstSide` when the result isn't shown.
      for (const player of firstSide) {
        if (player.isComputer) continue
        const entry = results.find(([userId]) => userId === player.id)
        if (entry) {
          result = entry[1].result
          break
        }
      }
    }
  }

  const gameType = getGameTypeLabel(game, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  const resultForNames = firstSide
    .map(player =>
      player.isComputer
        ? t('game.playerName.computer', 'Computer')
        : (nameById.get(player.id) ?? t('game.playerName.unknown', 'Unknown player')),
    )
    .join(', ')

  const layoutProps: GameListEntryLayoutProps = {
    leading: showResult ? (
      <Tooltip
        text={t('games.list.resultTooltip', {
          defaultValue: 'Result for {{names}}',
          names: resultForNames,
        })}>
        <GameListEntryResult $result={spoilerFree ? 'unknown' : result}>
          {spoilerFree ? '—' : getResultLabel(result, t, true)}
        </GameListEntryResult>
      </Tooltip>
    ) : undefined,
    players: <GamePlayersDisplay game={game} forUserId={forUserId} showTeamLabels={false} />,
    relativeTime: <GameRelativeTime timestampMs={game.startTime} />,
    duration: spoilerFree || !game.gameLength ? '—' : getGameDurationString(game.gameLength),
    mapName,
    gameTypeLabel: gameType,
  }

  return (
    <SelectableRowContainer
      {...buttonProps}
      $selected={selected}
      ref={ref}
      onContextMenu={onContextMenu ? e => onContextMenu(game.id, e) : undefined}>
      <GameListEntryLayout {...layoutProps} />
      <Ripple ref={rippleRef} />
    </SelectableRowContainer>
  )
}
