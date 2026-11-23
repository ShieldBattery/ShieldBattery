import { describe, expect, test } from 'vitest'
import { GameStatusString, ReportedGameStatus } from '../../common/games/game-status'
import { ActiveGameQuitError, updateActiveGame, waitForActiveGame } from './wait-for-active-game'

function status(id: string, state: GameStatusString, extra?: string): ReportedGameStatus {
  return { id, state, extra, isReplay: true }
}

describe('waitForActiveGame', () => {
  test('resolves when a waited-on game starts playing', async () => {
    const waiting = waitForActiveGame('waited-playing')
    updateActiveGame(status('waited-playing', 'launching'))
    updateActiveGame(status('waited-playing', 'playing'))
    await expect(waiting).resolves.toBeUndefined()
  })

  test('rejects when a waited-on game errors', async () => {
    const waiting = waitForActiveGame('waited-error')
    updateActiveGame(status('waited-error', 'error', 'boom'))
    await expect(waiting).rejects.toThrow('boom')
  })

  test('resolves a waiter that registers after the game started playing', async () => {
    updateActiveGame(status('late-playing', 'playing'))
    await expect(waitForActiveGame('late-playing')).resolves.toBeUndefined()
  })

  test('rejects a waiter that registers after the game errored', async () => {
    updateActiveGame(status('late-error', 'error', 'boom'))
    await expect(waitForActiveGame('late-error')).rejects.toThrow('boom')
  })

  test('rejects with the reason a launch failed when the status names one', async () => {
    updateActiveGame({ ...status('kind-error', 'error', 'boom'), launchErrorKind: 'verification' })
    await expect(waitForActiveGame('kind-error')).rejects.toMatchObject({
      launchErrorKind: 'verification',
    })
  })

  test('rejects as quit when a waited-on game is quit before playing', async () => {
    const waiting = waitForActiveGame('waited-quit')
    updateActiveGame(status('waited-quit', 'launching'))
    updateActiveGame(status('waited-quit', 'unknown'))
    await expect(waiting).rejects.toBeInstanceOf(ActiveGameQuitError)
  })

  test('rejects as quit a waiter that registers after the game was quit', async () => {
    updateActiveGame(status('late-quit', 'unknown'))
    await expect(waitForActiveGame('late-quit')).rejects.toBeInstanceOf(ActiveGameQuitError)
  })

  test('keeps a playing outcome when the game exits before anything waited', async () => {
    updateActiveGame(status('late-exit', 'playing'))
    updateActiveGame(status('late-exit', 'unknown'))
    await expect(waitForActiveGame('late-exit')).resolves.toBeUndefined()
  })

  test('does not settle a late waiter from a non-terminal status', async () => {
    updateActiveGame(status('late-launching', 'launching'))
    const result = await Promise.race([
      waitForActiveGame('late-launching').then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 10)),
    ])
    expect(result).toBe('pending')
  })

  test('keeps only the most recent unclaimed outcomes', async () => {
    updateActiveGame(status('evicted', 'playing'))
    for (let i = 0; i < 8; i++) {
      updateActiveGame(status(`filler-${i}`, 'playing'))
    }
    const result = await Promise.race([
      waitForActiveGame('evicted').then(() => 'settled'),
      new Promise(resolve => setTimeout(() => resolve('pending'), 10)),
    ])
    expect(result).toBe('pending')
    await expect(waitForActiveGame('filler-7')).resolves.toBeUndefined()
  })
})
