import { useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { labelSmall } from '../../styles/typography'
import { LobbySummaryLoadState } from '../lobby-summary'
import { JoinableLobbyContent } from '../view'
import { MOCK_LOBBY_SUMMARY } from './lobby-landing-test'

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

const ControlsLabel = styled.div`
  ${labelSmall};
  color: var(--theme-on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin: 16px 16px 8px;
`

const ScenarioButtons = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 16px;
`

const ScenarioBtn = styled.button<{ $active: boolean }>`
  ${labelSmall};
  padding: 6px 14px;
  border-radius: 20px;
  border: 1px solid
    ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-outline-variant)')};
  background: ${props =>
    props.$active ? 'color-mix(in srgb, var(--theme-primary) 15%, transparent)' : 'transparent'};
  color: ${props => (props.$active ? 'var(--theme-primary)' : 'var(--theme-on-surface-variant)')};
  cursor: pointer;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease;

  &:hover {
    background: color-mix(in srgb, var(--theme-primary) 10%, transparent);
    border-color: var(--theme-primary);
    color: var(--theme-primary);
  }
`

export function JoinPreviewTest() {
  const [scenario, setScenario] = useState<Scenario>('preview')
  const { summary, lobbyGone, lobbyStarted, isJoining } = scenarioToProps(scenario)

  return (
    <div>
      <ControlsLabel>Scenario</ControlsLabel>
      <ScenarioButtons>
        {SCENARIOS.map(s => (
          <ScenarioBtn key={s.id} $active={scenario === s.id} onClick={() => setScenario(s.id)}>
            {s.label}
          </ScenarioBtn>
        ))}
      </ScenarioButtons>
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
