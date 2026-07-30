import { useState } from 'react'
import styled from 'styled-components'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { labelSmall } from '../../styles/typography'
import { LobbyLandingContent, LobbyLandingState } from '../lobby-landing'

const MOCK_HOST: SbUser = { id: makeSbUserId(1), name: 'HostUser', created: 0 }

const MOCK_LOBBY_ID = makeSbLobbyId(encodePrettyId('5eed0000-0000-0000-0000-000000000042'))

const MOCK_SUMMARY: LobbySummaryResponse = {
  summary: {
    id: MOCK_LOBBY_ID,
    name: 'Fastest Game Ever',
    map: {
      id: makeSbMapId('map-1'),
      name: 'Fighting Spirit',
      mapData: { width: 128, height: 128 },
    },
    gameType: GameType.Melee,
    gameSubType: 0,
    host: { id: MOCK_HOST.id },
    openSlotCount: 3,
  },
  host: MOCK_HOST,
}

type Scenario = 'loading' | 'notFound' | 'error' | 'loaded'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'notFound', label: 'Not found' },
  { id: 'error', label: 'Error' },
  { id: 'loaded', label: 'Loaded' },
]

function scenarioToState(scenario: Scenario): LobbyLandingState | undefined {
  switch (scenario) {
    case 'loading':
      return undefined
    case 'notFound':
      return { status: 'notFound' }
    case 'error':
      return { status: 'error' }
    case 'loaded':
      return { status: 'loaded', data: MOCK_SUMMARY }
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

export function LobbyLandingTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')

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
      <LobbyLandingContent state={scenarioToState(scenario)} />
    </div>
  )
}
