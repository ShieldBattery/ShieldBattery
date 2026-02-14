import { useTranslation } from 'react-i18next'
import styled from 'styled-components'
import {
  MatchupFilter as MatchupFilterType,
  MatchupRaceSlot,
} from '../../common/games/game-filters'
import { AssignedRaceChar } from '../../common/races'
import { RaceButton, RacePickerSize, StyledRaceIcon } from '../lobbies/race-picker'
import { useButtonState } from '../material/button'
import { Ripple } from '../material/ripple'
import { labelMedium } from '../styles/typography'

const Container = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
`

const TeamContainer = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`

const VsText = styled.span`
  ${labelMedium};
  color: var(--theme-on-surface-variant);
`

export interface MatchupFilterProps {
  matchup: MatchupFilterType
  onMatchupChange: (matchup: MatchupFilterType) => void
  className?: string
}

/**
 * A dynamic matchup filter that shows race selectors based on the selected game format.
 * For example, 3v3 shows 3 race selectors per team (6 total).
 */
export function MatchupFilter({ matchup, onMatchupChange, className }: MatchupFilterProps) {
  const { t } = useTranslation()

  return (
    <Container className={className}>
      <TeamContainer>
        {matchup.team1.map((_, i) => (
          <MatchupRacePicker
            key={`team1-${i}`}
            race={matchup.team1[i]}
            onSetRace={race => {
              onMatchupChange({
                team1: matchup.team1.map((r, j) => (j === i ? race : r)),
                team2: matchup.team2,
              })
            }}
          />
        ))}
      </TeamContainer>

      <VsText>{t('game.filters.vs', 'vs')}</VsText>

      <TeamContainer>
        {matchup.team2.map((_, i) => (
          <MatchupRacePicker
            key={`team2-${i}`}
            race={matchup.team2[i]}
            onSetRace={race => {
              onMatchupChange({
                team1: matchup.team1,
                team2: matchup.team2.map((r, j) => (j === i ? race : r)),
              })
            }}
          />
        ))}
      </TeamContainer>
    </Container>
  )
}

interface MatchupRacePickerProps {
  /** The currently selected race, or undefined for none selected. */
  race: MatchupRaceSlot
  onSetRace?: (race: MatchupRaceSlot) => void
}

/**
 * A custom race picker component for the matchup filter, which allows unset slots.
 */
function MatchupRacePicker({ race, onSetRace }: MatchupRacePickerProps) {
  const [zergButtonProps, zergRippleRef] = useButtonState({
    onClick: () => onSetRace?.(race === 'z' ? undefined : 'z'),
  })
  const [protossButtonProps, protossRippleRef] = useButtonState({
    onClick: () => onSetRace?.(race === 'p' ? undefined : 'p'),
  })
  const [terranButtonProps, terranRippleRef] = useButtonState({
    onClick: () => onSetRace?.(race === 't' ? undefined : 't'),
  })

  const races: AssignedRaceChar[] = ['z', 'p', 't']
  const buttonProps = [zergButtonProps, protossButtonProps, terranButtonProps]
  const rippleRefs = [zergRippleRef, protossRippleRef, terranRippleRef]

  return (
    <div>
      {races.map((r, i) => (
        <RaceButton
          key={r}
          type='button'
          $size={RacePickerSize.Medium}
          $race={r}
          $active={r === race}
          $allowInteraction={true}
          {...buttonProps[i]}>
          <StyledRaceIcon race={r} applyRaceColor={false} $size={RacePickerSize.Medium} />
          <Ripple ref={rippleRefs[i]} />
        </RaceButton>
      ))}
    </div>
  )
}
