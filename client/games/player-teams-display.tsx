import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import { getResultLabel, getResultShortLabel, ReconciledResult } from '../../common/games/results'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { RaceIcon } from '../lobbies/race-icon'
import { labelMedium, labelSmall, singleLine, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const PlayerTeamsRoot = styled.div`
  display: flex;
  /*
    A team column with fewer rows (e.g. a lone player against a duo) centers against its taller
    neighbor instead of hanging from the first line.
  */
  align-items: center;
  gap: 16px;
`

const PlayerTeamColumn = styled.div`
  min-width: 0;
  flex: 1 1 0;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

const PlayerTeamOverline = styled.div`
  ${labelMedium};
  ${singleLine};

  color: var(--theme-on-surface-variant);
`

const PlayerTeamOverlineResult = styled.span<{ $result: ReconciledResult }>`
  color: ${props => {
    if (props.$result === 'win') {
      return 'var(--theme-positive)'
    } else if (props.$result === 'loss') {
      return 'var(--theme-negative)'
    } else {
      return 'inherit'
    }
  }};
`

const PlayerRowContainer = styled.div`
  height: 20px;

  display: flex;
  align-items: center;
`

const PlayerResultChip = styled.span<{ $result: ReconciledResult }>`
  ${labelSmall};
  /*
    Sized by its label rather than fixed, since some locales abbreviate results to several
    characters (e.g. Russian) instead of one letter.
  */
  min-width: 16px;
  padding: 0 3px;
  height: 16px;
  margin-right: 6px;
  flex-shrink: 0;

  display: inline-flex;
  align-items: center;
  justify-content: center;

  border-radius: 4px;
  font-weight: 700;
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
  background: color-mix(in srgb, currentColor 16%, transparent);
`

const PlayerRowName = styled.span<{ $dimmed?: boolean }>`
  ${titleSmall};
  ${singleLine};

  ${props => (props.$dimmed ? 'color: var(--theme-on-surface-variant);' : '')}
`

const PlayerRowConnectedName = styled(ConnectedUsername)`
  ${titleSmall};
  ${singleLine};
`

const PlayerRaceRoot = styled.div`
  position: relative;
  width: auto;
  height: 20px;
  margin-right: 4px;
`

const PlayerAssignedRace = styled(RaceIcon)`
  width: auto;
  height: 100%;
  aspect-ratio: 1;
`

const PlayerRandomIcon = styled(RaceIcon)`
  position: absolute;
  /*
    NOTE(tec27): For reasons I don't fully understand, 0 positions this at a place where it is
    clipped by the parent element.
  */
  bottom: 2px;
  right: 0;

  && {
    width: 12px;
    height: 12px;
  }

  & > * {
    text-shadow: 0 0 2px rgba(0, 0, 0, 0.7);
  }
`

interface PlayerRaceProps {
  race: RaceChar
  isRandom: boolean
}

function PlayerRace({ race, isRandom }: PlayerRaceProps) {
  return (
    <PlayerRaceRoot>
      <PlayerAssignedRace race={race} />
      {isRandom && race !== 'r' ? <PlayerRandomIcon race={'r'} /> : null}
    </PlayerRaceRoot>
  )
}

/** A single player entry to be rendered by `PlayerTeamsDisplay`. */
export interface PlayerTeamsDisplayPlayer {
  /** The race the player played/is playing as, after any Random assignment has been resolved. */
  race: RaceChar
  /** Whether the player had originally selected Random as their race. */
  isRandom: boolean
  name: string
  /** The color treatment for the player's name. Defaults to `'normal'`. */
  nameColor?: 'normal' | 'dimmed'
  /**
   * The ShieldBattery user id for this player, if known. When set, the player's name renders as a
   * connected, interactive username resolved from the store instead of the provided `name`. The
   * connected name shows a loading placeholder until the store has the user — and forever, if the
   * id can never be resolved — so callers whose ids come from untrusted sources (e.g. replay
   * files) should only set this for users known to exist.
   */
  userId?: SbUserId
  /**
   * The player's own reconciled result. Anything other than `'unknown'` renders as a compact
   * win/loss/draw marker ahead of the race icon.
   */
  result?: ReconciledResult
}

/**
 * Renders a list of teams (each a list of players) as side-by-side columns, showing each player's
 * race and name. Names render as plain strings by default, or as store-connected, interactive
 * usernames for entries that carry a `userId`.
 */
export function PlayerTeamsDisplay({
  teams,
  teamLabels,
  teamResults,
  className,
}: {
  teams: ReadonlyArray<ReadonlyArray<PlayerTeamsDisplayPlayer>>
  teamLabels?: ReadonlyArray<string>
  /**
   * One reconciled result per team, aligned by index with `teams`. A team's result takes the
   * place of its label in the column overline; the label only shows for teams without one.
   */
  teamResults?: ReadonlyArray<ReconciledResult>
  className?: string
}) {
  const { t } = useTranslation()

  return (
    <PlayerTeamsRoot className={className}>
      {teams.map((team, teamIndex) => {
        const label = teamLabels?.[teamIndex]
        const result = teamResults?.[teamIndex]
        let overline: React.ReactNode
        if (result) {
          overline = (
            <PlayerTeamOverlineResult $result={result}>
              {getResultLabel(result, t)}
            </PlayerTeamOverlineResult>
          )
        } else if (label) {
          overline = label
        }

        return (
          <PlayerTeamColumn key={`team-${teamIndex}`}>
            {overline ? <PlayerTeamOverline>{overline}</PlayerTeamOverline> : null}
            {team.map((player, playerIndex) => (
              <PlayerRowContainer key={`player-${playerIndex}`}>
                {player.result && player.result !== 'unknown' ? (
                  <PlayerResultChip
                    $result={player.result}
                    role='img'
                    aria-label={getResultLabel(player.result, t)}
                    title={getResultLabel(player.result, t)}>
                    {getResultShortLabel(player.result, t)}
                  </PlayerResultChip>
                ) : null}
                <PlayerRace race={player.race} isRandom={player.isRandom} />
                {player.userId !== undefined ? (
                  <PlayerRowConnectedName userId={player.userId} />
                ) : (
                  <PlayerRowName $dimmed={player.nameColor === 'dimmed'}>
                    {player.name}
                  </PlayerRowName>
                )}
              </PlayerRowContainer>
            ))}
          </PlayerTeamColumn>
        )
      })}
    </PlayerTeamsRoot>
  )
}
