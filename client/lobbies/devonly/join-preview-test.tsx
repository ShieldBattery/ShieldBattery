import { useState } from 'react'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeServerUrl } from '../../network/server-url'
import { LobbySummaryLoadState } from '../lobby-summary'
import { JoinableLobbyContent } from '../view'
import { IsolatedReduxProvider } from './isolated-redux'
import {
  MOCK_LOBBY_SUMMARY as BASE_SUMMARY,
  MOCK_LOBBY_SUMMARY_IN_GAME as BASE_SUMMARY_IN_GAME,
} from './lobby-landing-test'
import { ScenarioPicker } from './scenario-picker'

/** Map images served by a local dev server that has this map uploaded. */
const ECLIPSE_HASH = 'a34a9fb5056ed95c219d6bf7fbc341f9f078eccacd67eeff5112669c7695761c'
const ECLIPSE_BASE = `/files/map_images/${ECLIPSE_HASH.slice(0, 2)}/${ECLIPSE_HASH.slice(2, 4)}/${ECLIPSE_HASH}`

function withEclipse(summary: LobbySummaryResponse): LobbySummaryResponse {
  return {
    ...summary,
    summary: {
      ...summary.summary,
      map: {
        ...summary.summary.map,
        name: 'Eclipse 1.2',
        image256Url: makeServerUrl(`${ECLIPSE_BASE}-256.jpg?v=1`),
        image512Url: makeServerUrl(`${ECLIPSE_BASE}-512.jpg?v=1`),
        image1024Url: makeServerUrl(`${ECLIPSE_BASE}-1024.jpg?v=1`),
      },
    },
  }
}

const MOCK_LOBBY_SUMMARY = withEclipse(BASE_SUMMARY)
const MOCK_LOBBY_SUMMARY_IN_GAME = withEclipse(BASE_SUMMARY_IN_GAME)

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
    <IsolatedReduxProvider>
      <ScenarioPicker scenarios={SCENARIOS} active={scenario} onChange={setScenario} />
      <JoinableLobbyContent
        summary={summary}
        lobbyGone={lobbyGone}
        isJoining={isJoining}
        onJoinClick={() => {}}
      />
    </IsolatedReduxProvider>
  )
}
