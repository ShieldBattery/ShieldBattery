import { describe, expect, test } from 'vitest'
import { GameStatusString } from '../../common/games/game-status'
import { ActiveGameActions } from './actions'
import gameClientReducerImport, { GameClientState, isInActiveGame } from './game-client-reducer'

// The imported reducer accepts any action, so narrow the parameter to the ones it handles, which
// lets action objects be written inline without tripping excess property checks.
const gameClientReducer: (
  state: GameClientState | undefined,
  action: ActiveGameActions,
) => GameClientState = gameClientReducerImport

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
    }

    expect(isInActiveGame(gameClientState)).toBe(expected)
  })
})

describe('gameClientReducer', () => {
  test('stays in an active game from launch until the game finishes', () => {
    let state = gameClientReducer(undefined, { type: '@active-game/launch', payload: 'game-1' })
    expect(isInActiveGame(state)).toBe(false)

    const observed: Array<[GameStatusString, boolean]> = []
    for (const status of [
      'launching',
      'configuring',
      'awaitingPlayers',
      'starting',
      'playing',
      'hasResult',
      'resultSent',
      'finished',
    ] as const) {
      state = gameClientReducer(state, {
        type: '@active-game/status',
        payload: { id: 'game-1', state: status, isReplay: false },
      })
      observed.push([status, isInActiveGame(state)])
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
    let state = gameClientReducer(undefined, { type: '@active-game/launch', payload: 'game-1' })
    state = gameClientReducer(state, {
      type: '@active-game/status',
      payload: { id: 'game-1', state: 'launching', isReplay: false },
    })
    state = gameClientReducer(state, {
      type: '@active-game/status',
      payload: { id: 'game-1', state: 'error', isReplay: false },
    })

    expect(isInActiveGame(state)).toBe(false)
  })
})
