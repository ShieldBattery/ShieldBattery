import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { LobbyInviteCardContent } from '../lobby-invite-card'
import { LobbySummaryLoadState } from '../lobby-summary'
import { MOCK_LOBBY_SUMMARY } from './lobby-landing-test'
import { ScenarioPicker } from './scenario-picker'

type Scenario = 'loading' | 'loaded' | 'notFound' | 'error'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'loaded', label: 'Loaded' },
  { id: 'notFound', label: 'Not found' },
  { id: 'error', label: 'Error' },
]

function scenarioToState(scenario: Scenario): LobbySummaryLoadState | undefined {
  switch (scenario) {
    case 'loading':
      return undefined
    case 'loaded':
      return { status: 'loaded', data: MOCK_LOBBY_SUMMARY }
    case 'notFound':
      return { status: 'notFound' }
    case 'error':
      return { status: 'error' }
    default:
      return assertUnreachable(scenario)
  }
}

export function LobbyInviteCardTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <LobbyInviteCardContent state={scenarioToState(scenario)} onJoinClick={() => {}} />
    </div>
  )
}
