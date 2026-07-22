import styled from 'styled-components'
import { RaceChar } from '../../common/races'
import { SbUserId } from '../../common/users/sb-user-id'
import { RaceIcon } from '../lobbies/race-icon'
import { labelMedium, singleLine, titleSmall } from '../styles/typography'
import { ConnectedUsername } from '../users/connected-username'

const PlayerTeamsRoot = styled.div`
  display: flex;
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

const PlayerRowContainer = styled.div`
  height: 20px;

  display: flex;
  align-items: center;
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
   * connected, interactive username resolved from the store instead of the provided `name`.
   */
  userId?: SbUserId
}

/**
 * Renders a list of teams (each a list of players) as side-by-side columns, showing each player's
 * race and name. Names render as plain strings by default, or as store-connected, interactive
 * usernames for entries that carry a `userId`.
 */
export function PlayerTeamsDisplay({
  teams,
  teamLabels,
  className,
}: {
  teams: ReadonlyArray<ReadonlyArray<PlayerTeamsDisplayPlayer>>
  teamLabels?: ReadonlyArray<string>
  className?: string
}) {
  return (
    <PlayerTeamsRoot className={className}>
      {teams.map((team, teamIndex) => (
        <PlayerTeamColumn key={`team-${teamIndex}`}>
          {teamLabels?.[teamIndex] ? (
            <PlayerTeamOverline>{teamLabels[teamIndex]}</PlayerTeamOverline>
          ) : null}
          {team.map((player, playerIndex) => (
            <PlayerRowContainer key={`player-${playerIndex}`}>
              <PlayerRace race={player.race} isRandom={player.isRandom} />
              {player.userId !== undefined ? (
                <PlayerRowConnectedName userId={player.userId} />
              ) : (
                <PlayerRowName $dimmed={player.nameColor === 'dimmed'}>{player.name}</PlayerRowName>
              )}
            </PlayerRowContainer>
          ))}
        </PlayerTeamColumn>
      ))}
    </PlayerTeamsRoot>
  )
}
