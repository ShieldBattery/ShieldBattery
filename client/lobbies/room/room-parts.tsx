import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getHumanSlots, Lobby } from '../../../common/lobbies'
import { LobbySeriesGameJson } from '../../../common/lobbies/lobby-network'
import { RaceChar, raceCharToLabel } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'
import { MaterialIcon } from '../../icons/material/material-icon'
import { buttonReset } from '../../material/button-reset'
import { Tooltip } from '../../material/tooltip'
import { getRaceColor } from '../../styles/colors'
import { labelSmall, singleLine } from '../../styles/typography'
import { RaceIcon } from '../race-icon'

/** The order races are laid out in, left to right, wherever all four are shown side by side. */
const RACE_ORDER: ReadonlyArray<RaceChar> = ['z', 'p', 't', 'r']

const RaceMarkIcon = styled(RaceIcon)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;

  fill: currentColor;
`

/** A player's race, at the size the room's rows and cards read it at. */
export function RaceMark({ race, className }: { race: RaceChar; className?: string }) {
  const { t } = useTranslation()
  return <RaceMarkIcon race={race} ariaLabel={raceCharToLabel(race, t)} className={className} />
}

const RaceOption = styled.button<{ $race: RaceChar; $active: boolean }>`
  ${buttonReset};
  width: 28px;
  height: 28px;
  padding: 2px;
  flex-shrink: 0;

  display: flex;

  border-radius: 4px;

  --sb-race-color: ${props => getRaceColor(props.$race)};
  color: ${props => (props.$active ? 'var(--sb-race-color)' : 'var(--theme-on-surface-variant)')};
  opacity: ${props => (props.$active ? 1 : 0.72)};

  &:hover {
    color: var(--sb-race-color);
    opacity: 1;
  }
`

const RaceOptionIcon = styled(RaceIcon)`
  width: 100%;
  height: 100%;

  fill: currentColor;
`

const RacePickerRoot = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
`

/** The four races, laid out inline so a player can change theirs without leaving their row. */
export function InlineRacePicker({
  race,
  onSetRace,
  className,
}: {
  race: RaceChar
  onSetRace: (race: RaceChar) => void
  className?: string
}) {
  const { t } = useTranslation()
  return (
    <RacePickerRoot className={className}>
      {RACE_ORDER.map(r => (
        <RaceOption
          key={r}
          type='button'
          $race={r}
          $active={r === race}
          title={raceCharToLabel(r, t)}
          onClick={() => onSetRace(r)}>
          <RaceOptionIcon race={r} applyRaceColor={false} />
        </RaceOption>
      ))}
    </RacePickerRoot>
  )
}

const ReadyMarkRoot = styled.span<{ $ready: boolean }>`
  flex-shrink: 0;
  display: flex;

  color: ${props => (props.$ready ? 'var(--theme-positive)' : 'var(--theme-on-surface-variant)')};
  opacity: ${props => (props.$ready ? 1 : 0.6)};
`

/**
 * Whether a seated member has readied up for the next game.
 *
 * NOTE: Rendered as a filled check or an outlined ring rather than a colored dot, so it can't be
 * mistaken for a presence indicator.
 */
export function ReadyMark({ ready }: { ready: boolean }) {
  const { t } = useTranslation()
  return (
    <Tooltip
      text={
        ready
          ? t('lobbies.room.readyMark.ready', 'Ready')
          : t('lobbies.room.readyMark.notReady', 'Not ready yet')
      }>
      <ReadyMarkRoot $ready={ready}>
        <MaterialIcon icon={ready ? 'check_circle' : 'circle'} size={18} filled={ready} />
      </ReadyMarkRoot>
    </Tooltip>
  )
}

/** How the host can rearrange the seats before running the next game. */
export enum TeamArrangement {
  Swap = 'swap',
  Shuffle = 'shuffle',
}

/** A compact pill describing one piece of the lobby's setup. */
export const RoomChip = styled.div`
  ${labelSmall};
  ${singleLine};
  padding: 4px 10px;

  border: 1px solid transparent;
  border-radius: 999px;
  background-color: var(--theme-container-high);
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

/** The heading above one group of rows in the roster rail, e.g. `TEAM 1 · TOP`. */
export const SectionLabel = styled.div`
  ${labelSmall};
  ${singleLine};
  padding: 0 4px;

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const HostCrownRoot = styled.span`
  color: var(--theme-amber);
  flex-shrink: 0;
  display: flex;
`

/** Marks the row of the lobby's host. */
export function HostCrown({ tabIndex }: { tabIndex?: number }) {
  const { t } = useTranslation()
  return (
    <Tooltip text={t('lobbies.summary.hostLabel', 'Host')} tabIndex={tabIndex}>
      <HostCrownRoot>
        <MaterialIcon icon='crown' size={20} filled />
      </HostCrownRoot>
    </Tooltip>
  )
}

/**
 * Returns everyone the lobby waits on during a ready check: the people seated in it, players and
 * observers alike. Members on the bench have no part in the next game, so they aren't counted.
 */
export function getReadyEligibleUsers(lobby: Lobby): SbUserId[] {
  return getHumanSlots(lobby)
    .map(slot => slot.userId)
    .filter((userId): userId is SbUserId => userId !== undefined)
}

/** Counts everyone who is in the lobby, seated or waiting for a seat. */
export function memberCount(lobby: Lobby): number {
  return getReadyEligibleUsers(lobby).length + lobby.bench.length
}

/**
 * Returns how many of a series' games each player won.
 *
 * Only games with a settled result that names a winning team count, and only for the people on it:
 * a game still waiting on its results, one no team can be said to have won, and the computers a
 * winning team was made up of all add nothing to anyone's tally.
 */
export function getWinsByUser(games: ReadonlyArray<LobbySeriesGameJson>): Map<SbUserId, number> {
  const wins = new Map<SbUserId, number>()
  for (const game of games) {
    const winningTeamIndex = game.result?.winningTeamIndex
    if (winningTeamIndex === undefined) {
      continue
    }

    for (const player of game.teams[winningTeamIndex]?.players ?? []) {
      if (player.type === 'human') {
        wins.set(player.userId, (wins.get(player.userId) ?? 0) + 1)
      }
    }
  }

  return wins
}

/** Formats a game's length as `M:SS`, growing to `H:MM:SS` once it runs past an hour. */
export function formatGameDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const seconds = totalSeconds % 60
  const minutes = Math.floor(totalSeconds / 60) % 60
  const hours = Math.floor(totalSeconds / 3600)

  const paddedSeconds = String(seconds).padStart(2, '0')
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}`
    : `${minutes}:${paddedSeconds}`
}
