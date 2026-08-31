import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { makeSbMapId } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { LaunchFlowState, LobbyLandingContent } from '../lobby-landing'
import { LobbySummaryLoadState } from '../lobby-summary'
import { ScenarioPicker } from './scenario-picker'

const MOCK_HOST: SbUser = { id: makeSbUserId(1), name: 'HostUser', created: 0 }

const MOCK_LOBBY_ID = makeSbLobbyId(encodePrettyId('5eed0000-0000-0000-0000-000000000042'))

const MOCK_LOBBY_SUMMARY_BASE = {
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
    playerSlots: { taken: 1, total: 4, open: 3 },
    useLegacyLimits: false,
  },
  host: MOCK_HOST,
}

export const MOCK_LOBBY_SUMMARY: LobbySummaryResponse = {
  ...MOCK_LOBBY_SUMMARY_BASE,
  joinCode: 'BQ4XM9',
}

const MOCK_LOBBY_SUMMARY_NO_CODE: LobbySummaryResponse = MOCK_LOBBY_SUMMARY_BASE

type Scenario =
  | 'loading'
  | 'notFound'
  | 'error'
  | 'loaded'
  | 'opening'
  | 'failed'
  | 'loadedNoScheme'
  | 'loadedNoCode'

const SCENARIOS: Array<{ id: Scenario; label: string }> = [
  { id: 'loading', label: 'Loading' },
  { id: 'notFound', label: 'Not found' },
  { id: 'error', label: 'Error' },
  { id: 'loaded', label: 'Loaded (code + scheme)' },
  { id: 'opening', label: 'Opening in app' },
  { id: 'failed', label: 'App failed to open' },
  { id: 'loadedNoScheme', label: 'Loaded (no scheme)' },
  { id: 'loadedNoCode', label: 'Loaded (no join code)' },
]

interface ScenarioProps {
  state: LobbySummaryLoadState | undefined
  forceLaunchState?: LaunchFlowState
  forceSchemeAvailable?: boolean
}

function scenarioToProps(scenario: Scenario): ScenarioProps {
  switch (scenario) {
    case 'loading':
      return { state: undefined }
    case 'notFound':
      return { state: { status: 'notFound' } }
    case 'error':
      return { state: { status: 'error' } }
    case 'loaded':
      return {
        state: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        forceLaunchState: 'idle',
        forceSchemeAvailable: true,
      }
    case 'opening':
      return {
        state: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        forceLaunchState: 'opening',
        forceSchemeAvailable: true,
      }
    case 'failed':
      return {
        state: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        forceLaunchState: 'failed',
        forceSchemeAvailable: true,
      }
    case 'loadedNoScheme':
      return {
        state: { status: 'loaded', data: MOCK_LOBBY_SUMMARY },
        forceSchemeAvailable: false,
      }
    case 'loadedNoCode':
      return {
        state: { status: 'loaded', data: MOCK_LOBBY_SUMMARY_NO_CODE },
        forceLaunchState: 'idle',
        forceSchemeAvailable: true,
      }
    default:
      return assertUnreachable(scenario)
  }
}

export function LobbyLandingTest() {
  const [scenario, setScenario] = useState<Scenario>('loaded')
  const { state, forceLaunchState, forceSchemeAvailable } = scenarioToProps(scenario)

  return (
    <div>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <LobbyLandingContent
        state={state}
        forceLaunchState={forceLaunchState}
        forceSchemeAvailable={forceSchemeAvailable}
      />
    </div>
  )
}
