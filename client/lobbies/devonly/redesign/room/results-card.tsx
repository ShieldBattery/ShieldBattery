import { Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import styled, { css } from 'styled-components'
import { Team } from '../../../../../common/lobbies'
import { SlotType } from '../../../../../common/lobbies/slot'
import { ConnectedAvatar } from '../../../../avatars/avatar'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { FilledButton, Label, TextButton } from '../../../../material/button'
import { elevationPlus2 } from '../../../../material/shadows'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import {
  bodyMedium,
  displaySmall,
  labelMedium,
  labelSmall,
  singleLine,
  titleMedium,
  titleSmall,
} from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { RaceIcon } from '../../../race-icon'
import { ScenarioData } from '../mock-data'
import { gameTypeLabel, RoomViewer } from './room-model'

/**
 * The team that took the game whose results this card reports. The mock series tally is ordered
 * [team 1, team 2], and rendering the finished game as a team 1 win puts both the positive and the
 * negative accent on screen at once.
 */
const WINNING_TEAM_INDEX = 0

type Outcome = 'win' | 'loss' | 'none'

const cardTransition: Transition = {
  default: { type: 'spring', visualDuration: 0.45, bounce: 0.3 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

const cardVariants: Variants = {
  hidden: { opacity: 0, y: 28, scale: 0.94 },
  shown: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { ...cardTransition, delayChildren: 0.14, staggerChildren: 0.07 },
  },
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  shown: { opacity: 1, y: 0, transition: { type: 'spring', visualDuration: 0.35, bounce: 0.2 } },
}

const CardRoot = styled(m.div)<{ $outcome: Outcome }>`
  ${containerStyles(ContainerLevel.High)};
  ${elevationPlus2};

  position: relative;
  max-width: 620px;
  margin: 12px 8px 12px 72px;
  padding: 16px 20px 20px;

  display: flex;
  flex-direction: column;
  gap: 16px;

  border-radius: 12px;
  overflow: hidden;

  &::before {
    position: absolute;
    content: '';
    inset: 0 0 auto 0;
    height: 4px;

    background-color: ${props =>
      props.$outcome === 'loss' ? 'var(--theme-negative)' : 'var(--theme-positive)'};
  }
`

const CardHeader = styled(m.div)`
  display: flex;
  align-items: center;
  gap: 12px;
`

const OutcomeBadge = styled.div<{ $outcome: Outcome }>`
  ${displaySmall};

  line-height: 40px;

  ${props => {
    switch (props.$outcome) {
      case 'win':
        return css`
          color: var(--theme-positive);
        `
      case 'loss':
        return css`
          color: var(--theme-negative);
        `
      case 'none':
        return css`
          color: var(--theme-on-surface-variant);
        `
      default:
        return css``
    }
  }}
`

const MatchLine = styled.div`
  ${labelMedium};

  flex-grow: 1;

  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-on-surface-variant);
`

const TeamsRow = styled(m.div)`
  display: flex;
  align-items: stretch;
  gap: 16px;
`

const TeamColumn = styled.div<{ $won: boolean }>`
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 12px;

  display: flex;
  flex-direction: column;
  gap: 8px;

  background-color: ${props =>
    props.$won
      ? 'rgb(from var(--theme-positive) r g b / 0.08)'
      : 'rgb(from var(--theme-negative) r g b / 0.08)'};
  border-radius: 8px;
  box-shadow: inset 2px 0 0 0
    ${props => (props.$won ? 'var(--theme-positive)' : 'var(--theme-negative)')};
`

const TeamHeading = styled.div<{ $won: boolean }>`
  ${labelSmall};

  display: flex;
  align-items: center;
  gap: 4px;

  color: ${props => (props.$won ? 'var(--theme-positive)' : 'var(--theme-negative)')};
  text-transform: uppercase;
  letter-spacing: 0.08em;
`

const PlayerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const PlayerAvatar = styled(ConnectedAvatar)`
  width: 24px;
  height: 24px;
  flex-shrink: 0;
`

const PlayerName = styled.div`
  ${titleSmall};
  ${singleLine};

  flex-grow: 1;
`

const PlayerRaceIcon = styled(RaceIcon)`
  width: 18px;
  height: 18px;
  flex-shrink: 0;

  fill: currentColor;
`

const SeriesColumn = styled.div`
  flex-shrink: 0;
  padding-inline: 4px;

  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
`

const SeriesLabel = styled.div`
  ${labelSmall};

  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.1em;
`

const SeriesScore = styled.div`
  ${displaySmall};

  display: flex;
  align-items: baseline;
  gap: 6px;

  font-variant-numeric: tabular-nums;
`

const WinnerScore = styled.span`
  color: var(--theme-positive);
`

const LoserScore = styled.span`
  color: var(--theme-negative);
`

const SeriesDash = styled.span`
  ${titleMedium};

  color: var(--theme-on-surface-variant);
`

const Actions = styled(m.div)`
  display: flex;
  align-items: center;
  gap: 16px;
`

const RunItBackButton = styled(FilledButton)`
  min-height: 48px;
  padding-inline: 20px 28px;

  & ${Label} {
    letter-spacing: 0.1em;
  }
`

const HostNote = styled.div`
  ${bodyMedium};

  flex-grow: 1;

  color: var(--theme-on-surface-variant);
`

function TeamResult({ team, index }: { team: Team; index: number }) {
  const won = index === WINNING_TEAM_INDEX
  const occupants = team.slots.filter(
    slot =>
      slot.type === SlotType.Human ||
      slot.type === SlotType.Computer ||
      slot.type === SlotType.UmsComputer,
  )

  return (
    <TeamColumn $won={won}>
      <TeamHeading $won={won}>
        {won ? <MaterialIcon icon='trophy' size={14} /> : null}
        {team.name}
      </TeamHeading>
      {occupants.map(slot => (
        <PlayerRow key={slot.id}>
          {slot.userId !== undefined ? <PlayerAvatar userId={slot.userId} /> : null}
          <PlayerName>
            {slot.userId !== undefined ? (
              <ConnectedUsername userId={slot.userId} interactive={false} />
            ) : (
              'Computer'
            )}
          </PlayerName>
          <PlayerRaceIcon race={slot.race} />
        </PlayerRow>
      ))}
    </TeamColumn>
  )
}

/**
 * The payoff moment: the game the room just played, dropped into chat as a rich card. Which side
 * won is stated in the biggest type on the surface, the series tally sits between the two teams so
 * it reads as a running score, and running it back is a single confident button away.
 */
export function ResultsCard({ data, viewer }: { data: ScenarioData; viewer: RoomViewer }) {
  const lobby = data.lobby
  const [wins, losses] = data.seriesScore ?? [0, 0]
  const teams = lobby.teams.filter(team => !team.isObserver)

  let outcome: Outcome = 'none'
  if (viewer.teamIndex !== undefined) {
    outcome = viewer.teamIndex === WINNING_TEAM_INDEX ? 'win' : 'loss'
  }

  let outcomeLabel = 'Final'
  if (outcome === 'win') {
    outcomeLabel = 'Victory'
  } else if (outcome === 'loss') {
    outcomeLabel = 'Defeat'
  }

  return (
    <CardRoot
      $outcome={outcome}
      variants={cardVariants}
      initial='hidden'
      animate='shown'
      data-testid='room-results-card'>
      <CardHeader variants={itemVariants}>
        <OutcomeBadge $outcome={outcome}>{outcomeLabel}</OutcomeBadge>
        <MatchLine>
          <MaterialIcon icon='map' size={16} />
          {lobby.map?.name} · {gameTypeLabel(lobby.gameType)}
        </MatchLine>
      </CardHeader>

      <TeamsRow variants={itemVariants}>
        {teams[0] ? <TeamResult team={teams[0]} index={0} /> : null}
        <SeriesColumn>
          <SeriesLabel>Series</SeriesLabel>
          <SeriesScore>
            <WinnerScore>{wins}</WinnerScore>
            <SeriesDash>–</SeriesDash>
            <LoserScore>{losses}</LoserScore>
          </SeriesScore>
        </SeriesColumn>
        {teams[1] ? <TeamResult team={teams[1]} index={1} /> : null}
      </TeamsRow>

      <Actions variants={itemVariants}>
        {viewer.isHost ? (
          <RunItBackButton
            label='RUN IT BACK'
            iconStart={<MaterialIcon icon='replay' size={20} />}
            onClick={() => console.log('run it back')}
          />
        ) : (
          <HostNote>Same seats, same races — waiting for the host to run it back.</HostNote>
        )}
        <TextButton label='View full results' onClick={() => console.log('view full results')} />
      </Actions>
    </CardRoot>
  )
}
