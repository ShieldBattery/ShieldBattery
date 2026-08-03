import { Transition, Variants } from 'motion/react'
import * as m from 'motion/react-m'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'
import { gameTypeToLabel } from '../../../../../common/games/game-type'
import { Team } from '../../../../../common/lobbies'
import { SlotType } from '../../../../../common/lobbies/slot'
import { MaterialIcon } from '../../../../icons/material/material-icon'
import { FilledButton, TextButton } from '../../../../material/button'
import { elevationPlus2 } from '../../../../material/shadows'
import { ContainerLevel, containerStyles } from '../../../../styles/colors'
import {
  headlineMedium,
  labelMedium,
  labelSmall,
  singleLine,
  titleLarge,
  titleSmall,
} from '../../../../styles/typography'
import { ConnectedUsername } from '../../../../users/connected-username'
import { RaceIcon } from '../../../race-icon'
import { BoardModel, logBoardAction } from './board-model'

/**
 * Which side took the game that just finished. The scenario data records a series tally rather than
 * per-game results, so the card picks a winner to render both the winning and losing treatments.
 */
const WINNING_TEAM_INDEX = 0

const cardVariants: Variants = {
  initial: { opacity: 0, y: 28, scale: 0.96 },
  animate: { opacity: 1, y: 0, scale: 1 },
}

const cardTransition: Transition = {
  default: { type: 'spring', duration: 0.55, bounce: 0.32 },
  opacity: { type: 'spring', duration: 0.35, bounce: 0 },
}

const ResultsRoot = styled(m.div)`
  ${containerStyles(ContainerLevel.Normal)};
  ${elevationPlus2};

  margin-block: 4px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--theme-outline-variant);

  display: flex;
  flex-direction: column;
  gap: 14px;
`

const ResultsHeader = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
`

const Outcome = styled.div<{ $tone: 'positive' | 'negative' | 'neutral' }>`
  ${headlineMedium};
  text-transform: uppercase;
  letter-spacing: 0.04em;

  color: ${props => {
    switch (props.$tone) {
      case 'positive':
        return 'var(--theme-positive)'
      case 'negative':
        return 'var(--theme-negative)'
      default:
        return 'var(--theme-on-surface)'
    }
  }};
`

const ResultsMeta = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

const TeamsGrid = styled.div`
  display: flex;
  gap: 12px;
`

const TeamResult = styled.div<{ $won: boolean }>`
  flex: 1 1 0;
  min-width: 0;
  padding: 10px 12px;

  border-radius: 8px;
  border-left: 3px solid
    ${props => (props.$won ? 'var(--theme-positive)' : 'var(--theme-negative)')};

  ${props =>
    props.$won
      ? css`
          background-color: rgb(from var(--theme-positive) r g b / 0.1);
        `
      : css`
          background-color: rgb(from var(--theme-negative) r g b / 0.08);
        `};
`

const TeamResultHeader = styled.div`
  margin-bottom: 8px;

  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`

const TeamResultName = styled.div`
  ${titleSmall};
  ${singleLine};
  color: var(--theme-on-surface);
`

const ResultTag = styled.div<{ $won: boolean }>`
  ${labelSmall};
  flex-shrink: 0;

  color: ${props => (props.$won ? 'var(--theme-positive)' : 'var(--theme-negative)')};
  letter-spacing: 0.1em;
  text-transform: uppercase;
`

const MemberRow = styled.div`
  ${labelMedium};
  height: 22px;

  display: flex;
  align-items: center;
  gap: 6px;

  color: var(--theme-on-surface-variant);
`

const MemberRaceIcon = styled(RaceIcon)`
  width: 16px;
  height: 16px;
  flex-shrink: 0;
`

const SeriesStrip = styled.div`
  padding: 10px 12px;

  display: flex;
  align-items: center;
  gap: 12px;

  background-color: rgb(from var(--theme-on-surface) r g b / 0.06);
  border-radius: 8px;
`

const SeriesLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.1em;
`

const SeriesScore = styled.div`
  ${titleLarge};
  font-feature-settings: 'tnum' on;
  color: var(--theme-on-surface);
`

const SeriesPips = styled.div`
  margin-left: auto;
  display: flex;
  gap: 6px;
`

const SeriesPip = styled.div<{ $tone: 'positive' | 'negative' }>`
  width: 10px;
  height: 10px;
  border-radius: 50%;

  background-color: ${props =>
    props.$tone === 'positive' ? 'var(--theme-positive)' : 'var(--theme-negative)'};
`

const ResultsActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`

const RunItBackButton = styled(FilledButton)`
  min-height: 52px;
  flex-grow: 1;

  background-color: var(--theme-positive);
  color: var(--theme-positive-invert);
`

function TeamResultBlock({ team, won }: { team: Team; won: boolean }) {
  const members = team.slots.filter(slot => slot.type === SlotType.Human)

  return (
    <TeamResult $won={won}>
      <TeamResultHeader>
        <TeamResultName>{team.name}</TeamResultName>
        <ResultTag $won={won}>{won ? 'Win' : 'Loss'}</ResultTag>
      </TeamResultHeader>
      {members.map(slot => (
        <MemberRow key={slot.id}>
          <MemberRaceIcon race={slot.race} ariaLabel={slot.race} />
          <ConnectedUsername userId={slot.userId!} interactive={false} />
        </MemberRow>
      ))}
    </TeamResult>
  )
}

/**
 * The regroup payoff, delivered into lobby chat where the game's story already lives: who won, what
 * the series stands at, and the one button that starts the next game.
 */
export function ResultsCard({ model }: { model: BoardModel }) {
  const { t } = useTranslation()
  const lobby = model.lobby
  const teams = lobby.teams.filter(team => !team.isObserver)
  const [firstScore, secondScore] = model.data.seriesScore ?? [0, 0]

  const viewerTeamIndex = teams.findIndex(team =>
    team.slots.some(slot => slot.userId === model.selfUserId),
  )
  let tone: 'positive' | 'negative' | 'neutral' = 'neutral'
  let outcomeWord = 'Game over'
  if (viewerTeamIndex === WINNING_TEAM_INDEX) {
    tone = 'positive'
    outcomeWord = 'Victory'
  } else if (viewerTeamIndex >= 0) {
    tone = 'negative'
    outcomeWord = 'Defeat'
  }

  const pips = [
    ...Array.from({ length: firstScore }, (_unused, i) => ({
      key: `w${i}`,
      tone: 'positive' as const,
    })),
    ...Array.from({ length: secondScore }, (_unused, i) => ({
      key: `l${i}`,
      tone: 'negative' as const,
    })),
  ]

  return (
    <ResultsRoot
      variants={cardVariants}
      transition={cardTransition}
      initial='initial'
      animate='animate'>
      <ResultsHeader>
        <Outcome $tone={tone}>{outcomeWord}</Outcome>
        <ResultsMeta>
          {`${lobby.map?.name ?? 'Unknown map'} · ${gameTypeToLabel(lobby.gameType, t)}`}
        </ResultsMeta>
      </ResultsHeader>

      <TeamsGrid>
        {teams.map((team, i) => (
          <TeamResultBlock key={team.teamId} team={team} won={i === WINNING_TEAM_INDEX} />
        ))}
      </TeamsGrid>

      <SeriesStrip>
        <SeriesLabel>Series</SeriesLabel>
        <SeriesScore>{`${firstScore} — ${secondScore}`}</SeriesScore>
        <SeriesPips>
          {pips.map(pip => (
            <SeriesPip key={pip.key} $tone={pip.tone} />
          ))}
        </SeriesPips>
      </SeriesStrip>

      <ResultsActions>
        {model.isHost ? (
          <RunItBackButton
            label='Run it back'
            iconStart={<MaterialIcon icon='replay' size={20} />}
            onClick={() => logBoardAction('runItBack')}
          />
        ) : null}
        <TextButton
          label='View full results'
          iconStart={<MaterialIcon icon='scoreboard' size={20} />}
          onClick={() => logBoardAction('viewGameResults')}
        />
      </ResultsActions>
    </ResultsRoot>
  )
}
