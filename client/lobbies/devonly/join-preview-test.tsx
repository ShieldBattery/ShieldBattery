import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { LobbySummaryLoadState } from '../lobby-summary'
import { JoinableLobbyContent } from '../view'
import { MOCK_LOBBY_SUMMARY } from './lobby-landing-test'
import { ScenarioPicker } from './scenario-picker'

type Scenario = 'loading' | 'preview' | 'joining' | 'fetchError' | 'gone' | 'started'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'preview', label: 'Preview' },
  { id: 'joining', label: 'Preview (joining)' },
  { id: 'fetchError', label: 'Fetch error' },
  { id: 'gone', label: 'No longer open' },
  { id: 'started', label: 'Started' },
]

function scenarioToProps(scenario: Scenario): {
  summary: LobbySummaryLoadState | undefined
  lobbyGone: boolean
  lobbyStarted: boolean
  isJoining: boolean
} {
  switch (scenario) {
    case 'loading':
      return { summary: undefined, lobbyGone: false, lobbyStarted: false, isJoining: false }
    case 'preview':
      return {
        summary: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        lobbyGone: false,
        lobbyStarted: false,
        isJoining: false,
      }
    case 'joining':
      return {
        summary: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        lobbyGone: false,
        lobbyStarted: false,
        isJoining: true,
      }
    case 'fetchError':
      return {
        summary: { status: 'error' },
        lobbyGone: false,
        lobbyStarted: false,
        isJoining: false,
      }
    case 'gone':
      return { summary: undefined, lobbyGone: true, lobbyStarted: false, isJoining: false }
    case 'started':
      return { summary: undefined, lobbyGone: false, lobbyStarted: true, isJoining: false }
    default:
      return assertUnreachable(scenario)
  }
}

export function JoinPreviewTest() {
  const [scenario, setScenario] = useState<Scenario>('preview')
  const { summary, lobbyGone, lobbyStarted, isJoining } = scenarioToProps(scenario)

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <JoinableLobbyContent
        summary={summary}
        lobbyGone={lobbyGone}
        lobbyStarted={lobbyStarted}
        isJoining={isJoining}
        onJoinClick={() => {}}
      />
    </div>
  )
}
