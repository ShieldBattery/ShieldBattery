import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  LobbyInviteCardContent,
  LobbyInviteDisplayData,
  LobbyInviteJoinedCard,
} from '../lobby-invite-card'
import { LobbySummaryLoadState } from '../lobby-summary'
import {
  MOCK_LOBBY_SUMMARY,
  MOCK_LOBBY_SUMMARY_IN_GAME,
  MOCK_LOBBY_SUMMARY_LAUNCHING,
} from './lobby-landing-test'
import { ScenarioPicker } from './scenario-picker'

type Scenario = 'loading' | 'loaded' | 'launching' | 'inGame' | 'notFound' | 'error' | 'joined'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'loaded', label: 'Loaded' },
  { id: 'launching', label: 'Starting game' },
  { id: 'inGame', label: 'In game' },
  { id: 'notFound', label: 'Not found' },
  { id: 'error', label: 'Error' },
  { id: 'joined', label: 'Joined (own lobby)' },
]

function scenarioToState(scenario: Exclude<Scenario, 'joined'>): LobbySummaryLoadState | undefined {
  switch (scenario) {
    case 'loading':
      return undefined
    case 'loaded':
      return { status: 'loaded', data: MOCK_LOBBY_SUMMARY }
    case 'launching':
      return { status: 'loaded', data: MOCK_LOBBY_SUMMARY_LAUNCHING }
    case 'inGame':
      return { status: 'loaded', data: MOCK_LOBBY_SUMMARY_IN_GAME }
    case 'notFound':
      return { status: 'notFound' }
    case 'error':
      return { status: 'error' }
    default:
      return assertUnreachable(scenario)
  }
}

// Mirrors what `OwnLobbyInviteCard` would build from live lobby state, using the same mock lobby
// as the other scenarios so the card's content stays comparable across them.
const MOCK_JOINED_DISPLAY: LobbyInviteDisplayData = {
  name: MOCK_LOBBY_SUMMARY.summary.name,
  map: MOCK_LOBBY_SUMMARY.summary.map,
  gameType: MOCK_LOBBY_SUMMARY.summary.gameType,
  hostName: MOCK_LOBBY_SUMMARY.host.name,
  openSlotCount: MOCK_LOBBY_SUMMARY.summary.playerSlots.open,
  lifecycle: MOCK_LOBBY_SUMMARY.summary.lifecycle,
}

export function LobbyInviteCardTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      {scenario === 'joined' ? (
        <LobbyInviteJoinedCard display={MOCK_JOINED_DISPLAY} />
      ) : (
        <LobbyInviteCardContent state={scenarioToState(scenario)} onJoinClick={() => {}} />
      )}
    </div>
  )
}
