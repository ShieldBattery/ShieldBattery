import { describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { MapInfoJson } from '../../../common/maps'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import {
  compareSummaries,
  friendsInLobby,
  LobbyBrowserSort,
  lobbyListStats,
  lobbyMatchesSearch,
} from './summary-utils'

const TEC27 = makeSbUserId(1)
const PACHI = makeSbUserId(2)
const DRONEBRO = makeSbUserId(3)
const SUNN0 = makeSbUserId(4)

const MAP = { id: 'test-map', name: 'Fighting Spirit' } as unknown as MapInfoJson

function makeSummary(overrides: Partial<LobbySummaryJson> = {}): LobbySummaryJson {
  return {
    id: 'lobby-1' as SbLobbyId,
    name: 'BGH no-rush 20',
    map: MAP,
    gameType: GameType.Melee,
    gameSubType: 0,
    host: { id: TEC27 },
    useLegacyLimits: false,
    benchCount: 0,
    playerSlots: { taken: 0, total: 0, open: 0 },
    observerSlots: { taken: 0, open: 0 },
    hasObserverTeam: false,
    occupantIds: [],
    createdAt: 1000,
    ...overrides,
  }
}

/** A 4-slot melee lobby: two humans, a computer, one open seat. */
const MELEE = makeSummary({
  playerSlots: { taken: 3, total: 4, open: 1 },
  occupantIds: [TEC27, PACHI],
})

/** A 2v2 with observers: one observer seated, one open, two closed. */
const WITH_OBSERVERS = makeSummary({
  id: 'lobby-2' as SbLobbyId,
  name: 'clan sQ scrims',
  gameType: GameType.TopVsBottom,
  gameSubType: 2,
  playerSlots: { taken: 2, total: 4, open: 1 },
  observerSlots: { taken: 1, open: 1 },
  hasObserverTeam: true,
  occupantIds: [TEC27, PACHI, DRONEBRO],
  createdAt: 2000,
})

describe('lobbies/browser/summary-utils', () => {
  describe('friendsInLobby', () => {
    test('returns the friends inside, in seating order', () => {
      const friends = new Map<SbUserId, unknown>([
        [DRONEBRO, {}],
        [TEC27, {}],
        [SUNN0, {}],
      ])
      expect(friendsInLobby(WITH_OBSERVERS, friends)).toEqual([TEC27, DRONEBRO])
    })

    test('is empty when no friends are inside', () => {
      expect(friendsInLobby(WITH_OBSERVERS, new Map([[SUNN0, {}]]))).toEqual([])
      expect(friendsInLobby(WITH_OBSERVERS, new Map())).toEqual([])
    })
  })

  describe('lobbyListStats', () => {
    test('tallies everyone seated in every listed lobby, players and observers alike', () => {
      expect(lobbyListStats([MELEE, WITH_OBSERVERS])).toEqual({ lobbies: 2, players: 5 })
      expect(lobbyListStats([])).toEqual({ lobbies: 0, players: 0 })
    })
  })

  describe('compareSummaries', () => {
    const older = makeSummary({ id: 'a' as SbLobbyId, name: 'aaa', createdAt: 1 })
    const newer = makeSummary({ id: 'b' as SbLobbyId, name: 'zzz', createdAt: 2 })

    test('newest puts the most recently created lobby first', () => {
      expect(
        [older, newer].sort((a, b) => compareSummaries(a, b, LobbyBrowserSort.Newest)),
      ).toEqual([newer, older])
    })

    test('most players puts the fullest lobby first', () => {
      const sorted = [MELEE, WITH_OBSERVERS].sort((a, b) =>
        compareSummaries(a, b, LobbyBrowserSort.MostPlayers),
      )
      expect(sorted.map(s => s.id)).toEqual([MELEE.id, WITH_OBSERVERS.id])
    })

    test('open slots puts the emptiest lobby first', () => {
      const roomy = makeSummary({
        id: 'roomy' as SbLobbyId,
        playerSlots: { taken: 1, total: 4, open: 3 },
      })
      const sorted = [MELEE, roomy].sort((a, b) =>
        compareSummaries(a, b, LobbyBrowserSort.OpenSlots),
      )
      expect(sorted.map(s => s.id)).toEqual([roomy.id, MELEE.id])
    })

    test('breaks ties by name, then by id', () => {
      const first = makeSummary({ id: 'zzz' as SbLobbyId, name: 'aaa', createdAt: 5 })
      const second = makeSummary({ id: 'aaa' as SbLobbyId, name: 'bbb', createdAt: 5 })
      const third = makeSummary({ id: 'bbb' as SbLobbyId, name: 'bbb', createdAt: 5 })

      expect(
        [third, second, first]
          .sort((a, b) => compareSummaries(a, b, LobbyBrowserSort.Newest))
          .map(s => s.id),
      ).toEqual(['zzz', 'aaa', 'bbb'])
    })
  })

  describe('lobbyMatchesSearch', () => {
    test('matches an empty query against everything', () => {
      expect(lobbyMatchesSearch(MELEE, '   ', undefined)).toBe(true)
    })

    test('matches lobby name, map name, and host name case-insensitively', () => {
      expect(lobbyMatchesSearch(MELEE, 'NO-RUSH', undefined)).toBe(true)
      expect(lobbyMatchesSearch(MELEE, 'fighting', undefined)).toBe(true)
      expect(lobbyMatchesSearch(MELEE, 'tec', 'tec27')).toBe(true)
    })

    test('does not match an unresolved host name', () => {
      expect(lobbyMatchesSearch(MELEE, 'tec', undefined)).toBe(false)
    })

    test('rejects a query that matches nothing', () => {
      expect(lobbyMatchesSearch(MELEE, 'poker defense', 'tec27')).toBe(false)
    })
  })
})
