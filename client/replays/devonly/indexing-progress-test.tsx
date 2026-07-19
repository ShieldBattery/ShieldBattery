import { useEffect, useState } from 'react'
import styled from 'styled-components'
import { ReplayBackfillProgress } from '../../../common/replays-library'
import { FilledButton } from '../../material/button'
import { CenteredContentContainer } from '../../styles/centered-container'
import { titleSmall } from '../../styles/typography'
import { BackfillProgressBar, ReplayLibraryUnavailable } from '../replay-library'

const Container = styled.div`
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px;
`

const Case = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;

  border: 1px solid var(--theme-outline-variant);
  border-radius: 8px;
`

const CaseLabel = styled.div`
  ${titleSmall};
  padding: 12px 16px 0;
  color: var(--theme-on-surface-variant);
`

const CaseBody = styled.div`
  padding: 0 16px 16px;
`

const Controls = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  padding: 0 16px 12px;
`

const DEMO_TOTAL = 11_248

/** A backfill whose `done` climbs from 0 to `DEMO_TOTAL` and back, to mimic a live index. */
function useAnimatedBackfill(running: boolean): ReplayBackfillProgress {
  const [done, setDone] = useState(0)

  useEffect(() => {
    if (!running) return undefined
    const interval = setInterval(() => {
      setDone(prev => (prev >= DEMO_TOTAL ? 0 : Math.min(DEMO_TOTAL, prev + 137)))
    }, 60)
    return () => clearInterval(interval)
  }, [running])

  return { phase: 'indexing', done, total: DEMO_TOTAL }
}

function StaticCase({ label, backfill }: { label: string; backfill: ReplayBackfillProgress }) {
  return (
    <Case>
      <CaseLabel>{label}</CaseLabel>
      <CaseBody>
        <BackfillProgressBar backfill={backfill} />
      </CaseBody>
    </Case>
  )
}

function AnimatedCase() {
  const [running, setRunning] = useState(true)
  const backfill = useAnimatedBackfill(running)
  return (
    <Case>
      <CaseLabel>Indexing (animated)</CaseLabel>
      <CaseBody>
        <BackfillProgressBar backfill={backfill} />
      </CaseBody>
      <Controls>
        <FilledButton label={running ? 'Pause' : 'Resume'} onClick={() => setRunning(r => !r)} />
      </Controls>
    </Case>
  )
}

export function IndexingProgressTest() {
  return (
    <CenteredContentContainer $targetWidth={960}>
      <Container>
        <StaticCase label='Scanning' backfill={{ phase: 'scanning' }} />
        <AnimatedCase />
        <StaticCase
          label='Indexing (start)'
          backfill={{ phase: 'indexing', done: 0, total: 11_248 }}
        />
        <StaticCase
          label='Indexing (partway)'
          backfill={{ phase: 'indexing', done: 4_137, total: 11_248 }}
        />
        <StaticCase
          label='Indexing (nearly done)'
          backfill={{ phase: 'indexing', done: 11_020, total: 11_248 }}
        />
        <Case>
          <CaseLabel>Unavailable</CaseLabel>
          <ReplayLibraryUnavailable />
        </Case>
      </Container>
    </CenteredContentContainer>
  )
}
