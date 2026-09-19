import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { LobbySummaryLoadState } from '../lobby-summary'
import { JoinableLobbyContent } from '../view'
import { MOCK_LOBBY_SUMMARY, MOCK_LOBBY_SUMMARY_IN_GAME } from './lobby-landing-test'
import { ScenarioPicker } from './scenario-picker'

type Scenario = 'loading' | 'preview' | 'inGame' | 'joining' | 'fetchError' | 'gone'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'preview', label: 'Preview' },
  { id: 'inGame', label: 'Preview (in game)' },
  { id: 'joining', label: 'Preview (joining)' },
  { id: 'fetchError', label: 'Fetch error' },
  { id: 'gone', label: 'No longer open' },
]

function scenarioToProps(scenario: Scenario): {
  summary: LobbySummaryLoadState | undefined
  lobbyGone: boolean
  isJoining: boolean
} {
  switch (scenario) {
    case 'loading':
      return { summary: undefined, lobbyGone: false, isJoining: false }
    case 'preview':
      return {
        summary: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        lobbyGone: false,
        isJoining: false,
      }
    case 'inGame':
      return {
        summary: { status: 'loaded', data: MOCK_LOBBY_SUMMARY_IN_GAME },
        lobbyGone: false,
        isJoining: false,
      }
    case 'joining':
      return {
        summary: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        lobbyGone: false,
        isJoining: true,
      }
    case 'fetchError':
      return { summary: { status: 'error' }, lobbyGone: false, isJoining: false }
    case 'gone':
      return { summary: undefined, lobbyGone: true, isJoining: false }
    default:
      return assertUnreachable(scenario)
  }
}

export function JoinPreviewTest() {
  const [scenario, setScenario] = useState<Scenario>('preview')
  const { summary, lobbyGone, isJoining } = scenarioToProps(scenario)

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <JoinableLobbyContent
        summary={summary}
        lobbyGone={lobbyGone}
        isJoining={isJoining}
        onJoinClick={() => {}}
      />
    </div>
  )
}
