import { describe, expect, test } from 'vitest'
import { GameStatusString } from '../../common/games/game-status'
import { ActiveGameActions } from './actions'
import gameClientReducerImport, {
  GameClientState,
  isInActiveGame,
  isInParticipatingGame,
} from './game-client-reducer'

// The imported reducer accepts any action, so narrow the parameter to the ones it handles, which
// lets action objects be written inline without tripping excess property checks.
const gameClientReducer: (
  state: GameClientState | undefined,
  action: ActiveGameActions,
) => GameClientState = gameClientReducerImport

function status(id: string, state: GameStatusString, isReplay: boolean): ActiveGameActions {
  return { type: '@active-game/status', payload: { id, state, isReplay } }
}

describe('isInActiveGame', () => {
  test.each<[string, GameStatusString | undefined, boolean]>([
    ['undefined status', undefined, false],
    ['launching', 'launching', true],
    ['configuring', 'configuring', true],
    ['awaitingPlayers', 'awaitingPlayers', true],
    ['starting', 'starting', true],
    ['playing', 'playing', true],
    ['hasResult', 'hasResult', true],
    ['resultSent', 'resultSent', true],
    ['unknown', 'unknown', false],
    ['finished', 'finished', false],
    ['error', 'error', false],
  ])('%s -> %s', (_name, state, expected) => {
    const gameClientState: GameClientState = {
      gameId: state !== undefined ? 'game-1' : undefined,
      status: state !== undefined ? { id: 'game-1', state, isReplay: false } : undefined,
      watchOnly: {},
    }

    expect(isInActiveGame(gameClientState)).toBe(expected)
  })
})

describe('gameClientReducer', () => {
  test('stays in an active game from launch until the game finishes', () => {
    let state = gameClientReducer(undefined, status('game-1', 'launching', false))

    const observed: Array<[GameStatusString, boolean]> = []
    for (const s of [
      'launching',
      'configuring',
      'awaitingPlayers',
      'starting',
      'playing',
      'hasResult',
      'resultSent',
      'finished',
    ] as const) {
      state = gameClientReducer(state, status('game-1', s, false))
      observed.push([s, isInActiveGame(state)])
    }

    expect(observed).toEqual([
      ['launching', true],
      ['configuring', true],
      ['awaitingPlayers', true],
      ['starting', true],
      ['playing', true],
      ['hasResult', true],
      ['resultSent', true],
      ['finished', false],
    ])
  })

  test('a launch that fails to load leaves no active game', () => {
    let state = gameClientReducer(undefined, status('game-1', 'launching', false))
    state = gameClientReducer(state, status('game-1', 'error', false))

    expect(isInActiveGame(state)).toBe(false)
  })

  test('a replay counts as an active game but not a participating one', () => {
    let state = gameClientReducer(undefined, status('replay-1', 'playing', true))

    expect(isInActiveGame(state)).toBe(true)
    expect(isInParticipatingGame(state)).toBe(false)
    expect(state.gameId).toBeUndefined()

    state = gameClientReducer(state, status('replay-1', 'unknown', true))
    expect(isInActiveGame(state)).toBe(false)
    expect(state.watchOnly).toEqual({})
  })

  test('replays leave the participating game status untouched', () => {
    let state = gameClientReducer(undefined, status('game-1', 'playing', false))
    state = gameClientReducer(state, status('replay-1', 'launching', true))
    state = gameClientReducer(state, status('replay-2', 'playing', true))
    state = gameClientReducer(state, status('replay-1', 'unknown', true))

    expect(state.gameId).toBe('game-1')
    expect(state.status?.state).toBe('playing')
    expect(Object.keys(state.watchOnly)).toEqual(['replay-2'])

    state = gameClientReducer(state, status('game-1', 'finished', false))
    expect(isInParticipatingGame(state)).toBe(false)
    expect(isInActiveGame(state)).toBe(true)

    state = gameClientReducer(state, status('replay-2', 'error', true))
    expect(isInActiveGame(state)).toBe(false)
  })
})
