import { useMemo, useState } from 'react'
import styled from 'styled-components'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { buttonReset } from '../../material/button-reset'
import { labelMedium } from '../../styles/typography'
import { MatchupMatrix, MatchupScope } from '../matchup-matrix'
import { EMPTY_MATCHUP_SOURCE, createMatchupSource } from '../matchup-source'
import { SEASONS } from './fixtures'
import { FIXTURE_RATING_BANDS, makeMatchupMode } from './matchup-fixtures'

const Container = styled.div`
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`

const Scenarios = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`

const ScenarioChip = styled.button<{ $active: boolean }>`
  ${buttonReset};
  ${labelMedium};
  padding: 5px 12px;
  border-radius: 999px;

  background: ${props => (props.$active ? 'var(--theme-container-highest)' : 'transparent')};
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  color: ${props =>
    props.$active ? 'var(--theme-on-surface)' : 'var(--theme-on-surface-variant)'};
`

/** `empty` isn't a state of the matrix -- it's a ready one with nothing in it. */
const SCENARIOS = ['ready', 'empty', 'loading', 'error'] as const
type Scenario = (typeof SCENARIOS)[number]

/**
 * Dev harness for the profile Matchups tab.
 *
 * The matrix is the real one -- this file only constructs data and picks which situation to show
 * it in. Every mode is offered, since the shape of the grid is the thing worth looking at here:
 * 3x3 for a solo mode, 6x6 for a 2v2 and 10x10 for a 3v3, each mostly sparse in the way a real
 * account is. Loading, error and empty are the states that need a slow, broken or brand-new
 * account to see against a live server.
 */
export function MatchupsPageTest() {
  const [scenario, setScenario] = useState<Scenario>('ready')
  const [mode, setMode] = useState<MatchmakingType>(MatchmakingType.Match1v1)
  const [scope, setScope] = useState<MatchupScope>('mine')

  // Regenerating on every render would reshuffle the matrix as you click around it. The scope is
  // part of the key because the global matrix is a different payload, not a filtered view of the
  // same one: the same shape and the same map pool, but every game across the whole ladder,
  // counted from both sides, which is why its numbers are larger and its records collapse to even.
  const source = useMemo(() => createMatchupSource(makeMatchupMode(mode, scope)), [mode, scope])

  return (
    <Container>
      <Scenarios>
        {SCENARIOS.map(s => (
          <ScenarioChip key={s} $active={scenario === s} onClick={() => setScenario(s)}>
            {s}
          </ScenarioChip>
        ))}
      </Scenarios>
      <MatchupMatrix
        source={scenario === 'ready' ? source : EMPTY_MATCHUP_SOURCE}
        state={scenario === 'empty' ? 'ready' : scenario}
        mode={mode}
        modes={ALL_MATCHMAKING_TYPES}
        onModeChange={setMode}
        scope={scope}
        onScopeChange={setScope}
        // The real page only offers seasons the mode was played in; the fixtures span all of
        // them, so all of them are offered here.
        seasons={[...SEASONS].reverse()}
        ratingBands={FIXTURE_RATING_BANDS}
      />
    </Container>
  )
}
