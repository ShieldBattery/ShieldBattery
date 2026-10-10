import { describe, expect, test } from 'vitest'
import { isLobbySummaryFull } from './lobby-network'

describe('common/lobbies/lobby-network', () => {
  describe('isLobbySummaryFull', () => {
    const noSeats = {
      lifecycle: 'gathering',
      playerSlots: { taken: 2, total: 2, open: 0 },
      observerSlots: { taken: 0, open: 0 },
    } as const

    test('a gathering lobby with no open player or observer seat is full', () => {
      expect(isLobbySummaryFull(noSeats)).toBe(true)
    })

    test('an open player seat keeps a lobby from being full', () => {
      expect(isLobbySummaryFull({ ...noSeats, playerSlots: { taken: 1, total: 2, open: 1 } })).toBe(
        false,
      )
    })

    test('an open observer seat keeps a lobby from being full', () => {
      expect(isLobbySummaryFull({ ...noSeats, observerSlots: { taken: 0, open: 1 } })).toBe(false)
    })

    test('a lobby with a game in progress is never full, since it takes joins onto its bench', () => {
      expect(isLobbySummaryFull({ ...noSeats, lifecycle: 'inGame' })).toBe(false)
    })
  })
})
