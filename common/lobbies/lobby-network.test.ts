import { describe, expect, test } from 'vitest'
import { makeSbUserId } from '../users/sb-user-id'
import { Lobby, Team } from './index'
import { getPlayerSeats, isLobbySummaryFull } from './lobby-network'
import {
  createClosed,
  createComputer,
  createControlledClosed,
  createControlledOpen,
  createHuman,
  createObserver,
  createOpen,
  createUmsComputer,
} from './slot'

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

  describe('getPlayerSeats', () => {
    function team(slots: Team['slots'], isObserver = false): Team {
      return { name: '', teamId: 0, isObserver, slots, hiddenSlots: [] }
    }

    test('lists player seats in team then slot order, without closed or observer seats', () => {
      const host = makeSbUserId(1)
      const guest = makeSbUserId(2)
      const watcher = makeSbUserId(3)
      const lobby = {
        teams: [
          team([createHuman(host), createClosed(), createOpen()]),
          team([createComputer(), createHuman(guest), createControlledClosed('r', 'c')]),
          team([createUmsComputer('z', 4, 5), createControlledOpen('r', 'c')]),
          team([createObserver(watcher), createOpen()], true),
        ],
      } as Partial<Lobby> as Lobby

      expect(getPlayerSeats(lobby)).toEqual([
        { type: 'human', userId: host },
        { type: 'open' },
        { type: 'computer' },
        { type: 'human', userId: guest },
        { type: 'computer' },
        { type: 'open' },
      ])
    })
  })
})
