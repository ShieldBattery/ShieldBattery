import { beforeEach, describe, expect, test } from 'vitest'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { FakeClock } from '../time/testing/fake-clock'
import { END_RETENTION_MS, GameLifecycleEvents } from './game-lifecycle-events'

const user1 = makeSbUserId(1)
const user2 = makeSbUserId(2)

describe('games/game-lifecycle-events/GameLifecycleEvents', () => {
  let clock: FakeClock
  let events: GameLifecycleEvents

  beforeEach(() => {
    clock = new FakeClock()
    clock.setCurrentTime(1_000_000)
    events = new GameLifecycleEvents(clock)
  })

  test('reports nothing for a game with no announced end', () => {
    expect(events.hasGameEnded('game')).toBe(false)
    expect(events.hasUserGameEnded('game', user1)).toBe(false)
  })

  test("remembers one user's end without implying the whole game's", () => {
    events.emit('userGameEnded', { gameId: 'game', userId: user1 })

    expect(events.hasUserGameEnded('game', user1)).toBe(true)
    expect(events.hasUserGameEnded('game', user2)).toBe(false)
    expect(events.hasGameEnded('game')).toBe(false)
  })

  test("remembers the whole game's end and treats it as every user's", () => {
    events.emit('gameEnded', { gameId: 'game' })

    expect(events.hasGameEnded('game')).toBe(true)
    expect(events.hasUserGameEnded('game', user1)).toBe(true)
    expect(events.hasUserGameEnded('game', user2)).toBe(true)
  })

  test('does not report an unrelated game', () => {
    events.emit('userGameEnded', { gameId: 'game', userId: user1 })
    events.emit('gameEnded', { gameId: 'other' })

    expect(events.hasUserGameEnded('game', user2)).toBe(false)
    expect(events.hasGameEnded('game')).toBe(false)
    expect(events.hasUserGameEnded('unrelated', user1)).toBe(false)
  })

  test('has recorded an end before any other listener sees the event', () => {
    let seen: boolean | undefined
    events.on('userGameEnded', ({ gameId, userId }) => {
      seen = events.hasUserGameEnded(gameId, userId)
    })

    events.emit('userGameEnded', { gameId: 'game', userId: user1 })

    expect(seen).toBe(true)
  })

  test('forgets an end once the retention has passed', () => {
    events.emit('userGameEnded', { gameId: 'game', userId: user1 })
    events.emit('gameEnded', { gameId: 'game' })

    clock.setCurrentTime(1_000_000 + END_RETENTION_MS - 1)
    expect(events.hasGameEnded('game')).toBe(true)

    clock.setCurrentTime(1_000_000 + END_RETENTION_MS)
    expect(events.hasGameEnded('game')).toBe(false)
    expect(events.hasUserGameEnded('game', user1)).toBe(false)
  })

  test('keeps an earlier end answerable for the retention of a later announcement', () => {
    events.emit('userGameEnded', { gameId: 'game', userId: user1 })
    clock.setCurrentTime(1_000_000 + END_RETENTION_MS - 1000)
    events.emit('userGameEnded', { gameId: 'game', userId: user2 })

    clock.setCurrentTime(1_000_000 + END_RETENTION_MS + 1000)

    expect(events.hasUserGameEnded('game', user1)).toBe(true)
    expect(events.hasUserGameEnded('game', user2)).toBe(true)
  })

  test('drops expired games when recording a new end', () => {
    events.emit('gameEnded', { gameId: 'old' })
    clock.setCurrentTime(1_000_000 + END_RETENTION_MS + 1)
    events.emit('gameEnded', { gameId: 'new' })

    // Back in time, the old game's record would still be answerable if it had been kept.
    clock.setCurrentTime(1_000_000)
    expect(events.hasGameEnded('old')).toBe(false)
  })
})
