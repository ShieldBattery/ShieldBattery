import * as React from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson, getGameDurationString, getGameTypeLabel } from '../../common/games/games'
import { getResultLabel, ReconciledResult } from '../../common/games/results'
import { SbUserId } from '../../common/users/sb-user-id'
import { ButtonStateStyleProps, useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { useAppSelector } from '../redux-hooks'
import { bodyMedium, singleLine, titleMedium, titleSmall } from '../styles/typography'
import { GamePlayersDisplay } from './game-players-display'

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

  const [buttonProps, rippleRef] = useButtonState({
    onClick: onClick ? () => onClick(game.id) : undefined,
    onDoubleClick: onDoubleClick ? () => onDoubleClick(game.id) : undefined,
  })

  const { results } = game

  // NOTE(2Pac): No need to memoize this under react-compiler; it re-derives only when its inputs
  // change.
  let result: ReconciledResult = 'unknown'
  if (results && forUserId) {
    for (const [userId, r] of results) {
      if (userId === forUserId) {
        result = r.result
        break
      }
    }
  }

  const gameType = getGameTypeLabel(game, t)
  const mapName = map?.name ?? t('game.mapName.unknown', 'Unknown map')

  const layoutProps: GameListEntryLayoutProps = {
    leading:
      showResult && forUserId ? (
        <GameListEntryResult $result={spoilerFree ? 'unknown' : result}>
          {spoilerFree ? '—' : getResultLabel(result, t, true)}
        </GameListEntryResult>
      ) : undefined,
    players: <GamePlayersDisplay game={game} forUserId={forUserId} showTeamLabels={false} />,
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
