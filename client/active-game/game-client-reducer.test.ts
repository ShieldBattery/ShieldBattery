import { describe, expect, test } from 'vitest'
import { GameStatusString } from '../../common/games/game-status'
import { GameClientState, isInActiveGame } from './game-client-reducer'

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
