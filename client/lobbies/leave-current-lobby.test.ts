import { describe, expect, test } from 'vitest'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import { isInCurrentLobbyGame } from './leave-current-lobby'
import lobbyReducer, { CurrentLobbyState, LobbyRunState } from './lobby-reducer'

const VIEWER = makeSbUserId(1)
const OTHER = makeSbUserId(2)

const DEFAULT_STATE: CurrentLobbyState = lobbyReducer(undefined, { type: '@@INIT' } as any)

function lobbyState(runState?: LobbyRunState): CurrentLobbyState {
  return {
    ...DEFAULT_STATE,
    info: { ...DEFAULT_STATE.info, name: 'Lobby A' },
    runState,
  }
}

function runState(inGameUsers: SbUserId[]): LobbyRunState {
  return { gameId: 'game', inGameUsers, elapsedMs: 0, startedAt: 0 }
}

describe('client/lobbies/leave-current-lobby/isInCurrentLobbyGame', () => {
  test('is true while the viewer is in the running game', () => {
    expect(isInCurrentLobbyGame(lobbyState(runState([VIEWER, OTHER])), VIEWER)).toBe(true)
  })

  test('is false while the lobby is gathering', () => {
    expect(isInCurrentLobbyGame(lobbyState(), VIEWER)).toBe(false)
  })

  test("is false when the viewer isn't in the running game", () => {
    expect(isInCurrentLobbyGame(lobbyState(runState([OTHER])), VIEWER)).toBe(false)
  })

  test("is false when the viewer isn't in a lobby", () => {
    expect(isInCurrentLobbyGame({ ...DEFAULT_STATE, runState: runState([VIEWER]) }, VIEWER)).toBe(
      false,
    )
  })
})
