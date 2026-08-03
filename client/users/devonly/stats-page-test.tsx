import { useState } from 'react'
import styled from 'styled-components'
import { MatchmakingType, isSoloType } from '../../../common/matchmaking'
import { buttonReset } from '../../material/button-reset'
import { labelMedium } from '../../styles/typography'
import { createMatchupSource } from '../matchup-source'
import { MatchupsSection } from '../matchups-section'
import { ModeStatsCard, ModeStatsCardState } from '../mode-stats-card'
import { MODES_BY_PLAYTIME, SEASONS, makeMatchupMode } from './stats-data'

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

const ModeList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const CARD_STATES: ReadonlyArray<ModeStatsCardState> = ['ready', 'loading', 'error']

/**
 * Dev harness for the profile Stats tab.
 *
 * The cards are the real ones -- this file only constructs data and picks which situation
 * to show them in. Loading and error are the states worth having here: against a live
 * server they need a slow or broken backend to see at all.
 */
export function StatsPageTest() {
  const [open, setOpen] = useState<MatchmakingType | undefined>(MODES_BY_PLAYTIME[0].type)
  const [state, setState] = useState<ModeStatsCardState>('ready')

  return (
    <Container>
      <Scenarios>
        {CARD_STATES.map(s => (
          <ScenarioChip key={s} $active={state === s} onClick={() => setState(s)}>
            {s}
          </ScenarioChip>
        ))}
      </Scenarios>
      <ModeList>
        {MODES_BY_PLAYTIME.map(mode => (
          <ModeStatsCard
            key={mode.type}
            matchmakingType={mode.type}
            wins={mode.wins}
            losses={mode.losses}
            rating={mode.rating}
            seasonDelta={mode.seasonDelta}
            open={open === mode.type}
            onToggle={() => setOpen(open === mode.type ? undefined : mode.type)}
            state={state}
            seasons={SEASONS}
            points={mode.history}
            totalGames={mode.history.length}
            downsampled={false}
            // Solo modes only, matching the real page -- a team matchup string can't say which
            // side the player was on, so those cards carry no matrix.
            //
            // The matrix is generated independently of the mode's rating history, so the
            // placements card shows a small header record above a matrix of hundreds of games.
            // That divergence is real rather than a fixture artefact: the header is
            // current-season where the player has one, while the matrix is always all-time, so
            // someone a few games into a reset season sees exactly this. Worth being able to
            // look at, which is why it isn't smoothed over here.
            footer={
              isSoloType(mode.type) ? (
                <MatchupsSection
                  source={createMatchupSource([makeMatchupMode(mode.type, mode.wins + 1)])}
                  modes={[mode.type]}
                  seasons={[...SEASONS].reverse()}
                />
              ) : undefined
            }
          />
        ))}
      </ModeList>
    </Container>
  )
}
