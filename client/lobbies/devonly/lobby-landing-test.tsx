import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { LobbyLandingContent } from '../lobby-landing'
import { LobbySummaryLoadState } from '../lobby-summary'
import { ScenarioPicker } from './scenario-picker'

const MOCK_HOST: SbUser = { id: makeSbUserId(1), name: 'HostUser', created: 0 }

const MOCK_LOBBY_ID = makeSbLobbyId(encodePrettyId('5eed0000-0000-0000-0000-000000000042'))

export const MOCK_LOBBY_SUMMARY: LobbySummaryResponse = {
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
    useLegacyLimits: false,
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

function scenarioToState(scenario: Scenario): LobbySummaryLoadState | undefined {
  switch (scenario) {
    case 'loading':
      return undefined
    case 'notFound':
      return { status: 'notFound' }
    case 'error':
      return { status: 'error' }
    case 'loaded':
      return { status: 'loaded', data: MOCK_LOBBY_SUMMARY }
    default:
      return assertUnreachable(scenario)
  }
}

export function LobbyLandingTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <LobbyLandingContent state={scenarioToState(scenario)} />
    </div>
  )
}
