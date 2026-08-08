import { describe, expect, test } from 'vitest'
import { GameType } from '../../../common/games/game-type'
import {
  LobbySummaryJson,
  LobbySummarySlotJson,
  LobbySummaryTeamJson,
} from '../../../common/lobbies/lobby-network'
import { SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { MapInfoJson } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import {
  compareSummaries,
  friendsInLobby,
  hasObserverTeam,
  hasOpenObserverSlot,
  humanUserIds,
  LobbyBrowserSort,
  lobbyListStats,
  lobbyMatchesSearch,
  observerCounts,
  occupantCount,
  openPlayerSlotCount,
  playerSlotCounts,
} from './summary-utils'

const TEC27 = makeSbUserId(1)
const PACHI = makeSbUserId(2)
const DRONEBRO = makeSbUserId(3)
const SUNN0 = makeSbUserId(4)

const MAP = { id: 'test-map', name: 'Fighting Spirit' } as unknown as MapInfoJson

function open(): LobbySummarySlotJson {
  return { type: 'open' }
}
function closed(): LobbySummarySlotJson {
  return { type: 'closed' }
}
function human(userId: SbUserId, race: RaceChar = 'r'): LobbySummarySlotJson {
  return { type: 'human', userId, race }
}
function computer(race: RaceChar = 'z'): LobbySummarySlotJson {
  return { type: 'computer', race }
}
function observer(userId: SbUserId): LobbySummarySlotJson {
  return { type: 'observer', userId }
}

function team(
  name: string,
  slots: LobbySummarySlotJson[],
  isObserver = false,
): LobbySummaryTeamJson {
  return { name, isObserver, slots }
}

function makeSummary(
  overrides: Partial<LobbySummaryJson> & Pick<LobbySummaryJson, 'teams'>,
): LobbySummaryJson {
  return {
    id: 'lobby-1' as SbLobbyId,
    name: 'BGH no-rush 20',
    map: MAP,
    gameType: GameType.Melee,
    gameSubType: 0,
    host: { id: TEC27 },
    openSlotCount: 0,
    useLegacyLimits: false,
    createdAt: 1000,
    ...overrides,
  }
}

/** A 4-slot melee lobby: two humans, a computer, one open seat. */
const MELEE = makeSummary({
  teams: [team('', [human(TEC27, 't'), human(PACHI, 'z'), computer('p'), open()])],
})

/** A 2v2 with observers: one observer seated, one open, two closed. */
const WITH_OBSERVERS = makeSummary({
  id: 'lobby-2' as SbLobbyId,
  name: 'clan sQ scrims',
  gameType: GameType.TopVsBottom,
  gameSubType: 2,
  teams: [
    team('Top', [human(TEC27, 't'), open()]),
    team('Bottom', [human(PACHI, 'z'), closed()]),
    team('Observers', [observer(DRONEBRO), open(), closed(), closed()], true),
  ],
  createdAt: 2000,
})

describe('lobbies/browser/summary-utils', () => {
  describe('playerSlotCounts', () => {
    test('counts humans and computers against every player slot', () => {
      expect(playerSlotCounts(MELEE)).toEqual({ taken: 3, total: 4 })
    })

    test('ignores the observer team', () => {
      expect(playerSlotCounts(WITH_OBSERVERS)).toEqual({ taken: 2, total: 4 })
    })

    test('counts closed slots toward the total', () => {
      expect(
        playerSlotCounts(makeSummary({ teams: [team('', [human(TEC27), closed()])] })),
      ).toEqual({ taken: 1, total: 2 })
    })
  })

  describe('openPlayerSlotCount', () => {
    test('counts only open player slots', () => {
      expect(openPlayerSlotCount(MELEE)).toBe(1)
      expect(openPlayerSlotCount(WITH_OBSERVERS)).toBe(1)
    })
  })

  describe('humanUserIds', () => {
    test('returns seated players and observers in seating order', () => {
      expect(humanUserIds(WITH_OBSERVERS)).toEqual([TEC27, PACHI, DRONEBRO])
    })

    test('excludes computers and empty slots', () => {
      expect(humanUserIds(MELEE)).toEqual([TEC27, PACHI])
    })
  })

  describe('observerCounts', () => {
    test('splits filled observer seats from open ones, ignoring closed ones', () => {
      expect(observerCounts(WITH_OBSERVERS)).toEqual({ taken: 1, open: 1 })
    })

    test('is empty for a lobby without observers', () => {
      expect(observerCounts(MELEE)).toEqual({ taken: 0, open: 0 })
      expect(hasObserverTeam(MELEE)).toBe(false)
    })
  })

  describe('hasOpenObserverSlot', () => {
    test('is true only while an observer seat is open', () => {
      expect(hasOpenObserverSlot(WITH_OBSERVERS)).toBe(true)
      expect(hasOpenObserverSlot(MELEE)).toBe(false)
      expect(
        hasOpenObserverSlot(
          makeSummary({
            teams: [team('', [human(TEC27)]), team('Observers', [observer(PACHI), closed()], true)],
          }),
        ),
      ).toBe(false)
    })
  })

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

  describe('occupantCount / lobbyListStats', () => {
    test('counts everyone seated, players and observers alike', () => {
      expect(occupantCount(WITH_OBSERVERS)).toBe(3)
      expect(occupantCount(MELEE)).toBe(2)
    })

    test('tallies every listed lobby regardless of filters', () => {
      expect(lobbyListStats([MELEE, WITH_OBSERVERS])).toEqual({ lobbies: 2, players: 5 })
      expect(lobbyListStats([])).toEqual({ lobbies: 0, players: 0 })
    })
  })

  describe('compareSummaries', () => {
    const older = makeSummary({ id: 'a' as SbLobbyId, name: 'aaa', createdAt: 1, teams: [] })
    const newer = makeSummary({ id: 'b' as SbLobbyId, name: 'zzz', createdAt: 2, teams: [] })

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
        teams: [team('', [human(TEC27), open(), open(), open()])],
      })
      const sorted = [MELEE, roomy].sort((a, b) =>
        compareSummaries(a, b, LobbyBrowserSort.OpenSlots),
      )
      expect(sorted.map(s => s.id)).toEqual([roomy.id, MELEE.id])
    })

    test('breaks ties by name, then by id', () => {
      const first = makeSummary({ id: 'zzz' as SbLobbyId, name: 'aaa', createdAt: 5, teams: [] })
      const second = makeSummary({ id: 'aaa' as SbLobbyId, name: 'bbb', createdAt: 5, teams: [] })
      const third = makeSummary({ id: 'bbb' as SbLobbyId, name: 'bbb', createdAt: 5, teams: [] })

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
