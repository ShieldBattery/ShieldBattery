import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  GameDurationFilter,
  GameSortOption,
  GameSourceFilter,
} from '../../../common/games/game-filters'
import { BROWSE_SHELF_SIZE, GameBrowseShelfId, GameRecord } from '../../../common/games/games'
import { makeSbMapId, MapInfo } from '../../../common/maps'
import { PublicMatchmakingRatingChangeJson } from '../../../common/matchmaking'
import { SbUser } from '../../../common/users/sb-user'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import { getMapInfos } from '../maps/map-models'
import { FakeClock } from '../time/testing/fake-clock'
import {
  BROWSE_SHELVES_TTL_MS,
  BROWSE_TOP_MAPS_TTL_MS,
  BrowseShelfSet,
  GameBrowseService,
  loadMyGamesShelves,
  loadRaceShelf,
  loadSharedShelves,
  loadTopMaps,
  mergeShelfSets,
  MY_GAMES_WINDOW,
  ReloadingValue,
} from './game-browse'
import { getGameListViewerFreeSideData } from './game-list-data'
import {
  getGames,
  getGamesForUser,
  getMostPlayedRanked1v1Race,
  getTopMapsSince,
} from './game-models'

const client = {} as DbClient

vi.mock('../db', () => ({
  withDbClient: vi.fn(async (fn: (c: DbClient, ...args: any[]) => any, ...args: any[]) =>
    fn(client, ...args),
  ),
}))
vi.mock('../maps/map-models', () => ({ getMapInfos: vi.fn() }))
vi.mock('./game-list-data', () => ({ getGameListViewerFreeSideData: vi.fn() }))
vi.mock('./game-models', () => ({
  getGames: vi.fn(),
  getGamesForUser: vi.fn(),
  getMostPlayedRanked1v1Race: vi.fn(),
  getTopMapsSince: vi.fn(),
}))

const NOW = new Date('2026-11-15T12:00:00Z')

const game = (id: string) => ({ id }) as GameRecord

beforeEach(() => {
  vi.mocked(getGames).mockReset()
  vi.mocked(getGamesForUser).mockReset()
  vi.mocked(getMostPlayedRanked1v1Race).mockReset()
  vi.mocked(getTopMapsSince).mockReset()
  vi.mocked(getTopMapsSince).mockResolvedValue([])
  vi.mocked(getMapInfos).mockReset()
  vi.mocked(getMapInfos).mockResolvedValue([])
  vi.mocked(getGameListViewerFreeSideData).mockReset()
  vi.mocked(getGameListViewerFreeSideData).mockResolvedValue({
    users: [],
    maps: [],
    mmrChanges: [],
  })
})

describe('games/game-browse/loadSharedShelves', () => {
  test('lists the shelves in display order, each from its own filters on the shared client', async () => {
    vi.mocked(getGames).mockImplementation(async params => [
      game(`${params.source ?? 'all'}-${params.format ?? params.duration ?? 'none'}`),
    ])

    const result = await loadSharedShelves(client)

    expect(result.shelves.map(s => s.id)).toEqual([
      GameBrowseShelfId.Ranked1v1,
      GameBrowseShelfId.Ranked2v2,
      GameBrowseShelfId.Ranked3v3,
      GameBrowseShelfId.Marathons,
      GameBrowseShelfId.Custom,
    ])
    const calls = vi.mocked(getGames).mock.calls
    expect(calls.every(([params, c]) => params.limit === BROWSE_SHELF_SIZE && c === client)).toBe(
      true,
    )
    expect(calls[0][0]).toMatchObject({ source: GameSourceFilter.Ranked, format: '1v1' })
    expect(calls[3][0]).toMatchObject({ duration: GameDurationFilter.Over30 })
    expect(calls[4][0]).toMatchObject({ source: GameSourceFilter.Custom })
  })

  test('drops empty shelves and lists each game once', async () => {
    vi.mocked(getGames)
      .mockResolvedValueOnce([game('a'), game('b')])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([game('b'), game('c')])
      .mockResolvedValueOnce([])

    const result = await loadSharedShelves(client)

    expect(result.shelves).toEqual([
      { id: GameBrowseShelfId.Ranked1v1, gameIds: ['a', 'b'] },
      { id: GameBrowseShelfId.Marathons, gameIds: ['b', 'c'] },
    ])
    expect(result.games.map(g => g.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('games/game-browse/loadRaceShelf', () => {
  test('lists ranked 1v1s with the race on either side', async () => {
    vi.mocked(getGames).mockResolvedValue([game('a')])

    const result = await loadRaceShelf(client, 'z')

    expect(result.shelves).toEqual([{ id: GameBrowseShelfId.YourRace, gameIds: ['a'] }])
    expect(vi.mocked(getGames).mock.calls[0][0]).toMatchObject({
      source: GameSourceFilter.Ranked,
      format: '1v1',
      matchup: { team1: ['z'], team2: [undefined] },
    })
  })
})

describe('games/game-browse/loadTopMaps', () => {
  test('counts maps over the past week and loads their infos', async () => {
    const topMaps = [{ mapId: makeSbMapId('m1'), gameCount: 4 }]
    vi.mocked(getTopMapsSince).mockResolvedValue(topMaps)
    const maps = [{ id: 'm1' }] as unknown as MapInfo[]
    vi.mocked(getMapInfos).mockResolvedValue(maps)

    const result = await loadTopMaps(client, NOW)

    expect(result).toEqual({ topMaps, maps })
    expect(vi.mocked(getTopMapsSince).mock.calls[0][0]).toEqual(new Date('2026-11-08T12:00:00Z'))
    expect(vi.mocked(getMapInfos).mock.calls[0][0]).toEqual(['m1'])
  })
})

describe('games/game-browse/loadMyGamesShelves', () => {
  test("lists the user's shelves in display order with their filters", async () => {
    const userId = makeSbUserId(5)
    vi.mocked(getGamesForUser).mockImplementation(async params => [
      game(
        `${params.result ?? params.opponentRace ?? params.sort ?? (params.teamGames ? 'team' : 'recent')}`,
      ),
    ])

    const result = await loadMyGamesShelves(client, userId)

    expect(result.shelves.map(s => s.id)).toEqual([
      GameBrowseShelfId.Recent,
      GameBrowseShelfId.Losses,
      GameBrowseShelfId.VsTerran,
      GameBrowseShelfId.VsZerg,
      GameBrowseShelfId.VsProtoss,
      GameBrowseShelfId.TeamGames,
      GameBrowseShelfId.Longest,
    ])
    const calls = vi.mocked(getGamesForUser).mock.calls.map(([params]) => params)
    expect(calls.every(p => p.userId === userId && p.limit === BROWSE_SHELF_SIZE)).toBe(true)
    expect(calls[1]).toMatchObject({ result: 'loss' })
    expect(calls[2]).toMatchObject({ format: '1v1', opponentRace: 't' })
    expect(calls[5]).toMatchObject({ teamGames: true })
    expect(calls[6]).toMatchObject({ sort: GameSortOption.LongestFirst })
  })

  test('only the recent shelf reads past the latest stretch of history', async () => {
    vi.mocked(getGamesForUser).mockResolvedValue([])

    await loadMyGamesShelves(client, makeSbUserId(5))

    const windows = vi.mocked(getGamesForUser).mock.calls.map(([params]) => params.latestGames)
    expect(windows).toEqual([undefined, ...Array(6).fill(MY_GAMES_WINDOW)])
  })
})

describe('games/game-browse/mergeShelfSets', () => {
  test('keeps every shelf and lists each game, user, map and rating change once', () => {
    const user = (id: number) => ({ id: makeSbUserId(id) }) as SbUser
    const map = (id: string) => ({ id }) as unknown as MapInfo
    const change = (gameId: string, userId: number) =>
      ({ gameId, userId: makeSbUserId(userId) }) as PublicMatchmakingRatingChangeJson
    const a: BrowseShelfSet = {
      shelves: [{ id: GameBrowseShelfId.Ranked1v1, gameIds: ['g1', 'g2'] }],
      games: [game('g1'), game('g2')],
      users: [user(1), user(2)],
      maps: [map('m1')],
      mmrChanges: [change('g1', 1), change('g2', 2)],
    }
    const b: BrowseShelfSet = {
      shelves: [{ id: GameBrowseShelfId.YourRace, gameIds: ['g2'] }],
      games: [game('g2')],
      users: [user(2)],
      maps: [map('m1'), map('m2')],
      mmrChanges: [change('g2', 2)],
    }

    const merged = mergeShelfSets([a, b])

    expect(merged.shelves.map(s => s.id)).toEqual([
      GameBrowseShelfId.Ranked1v1,
      GameBrowseShelfId.YourRace,
    ])
    expect(merged.games.map(g => g.id)).toEqual(['g1', 'g2'])
    expect(merged.users.map(u => u.id)).toEqual([1, 2])
    expect(merged.maps.map(m => m.id)).toEqual(['m1', 'm2'])
    expect(merged.mmrChanges).toHaveLength(2)
  })
})

describe('games/game-browse/ReloadingValue', () => {
  test('reuses a loaded value until it goes stale', async () => {
    const clock = new FakeClock()
    const load = vi.fn().mockResolvedValueOnce('first').mockResolvedValueOnce('second')
    const value = new ReloadingValue(1000, load, clock)

    expect(await value.get()).toBe('first')
    clock.setCurrentTime(999)
    expect(await value.get()).toBe('first')
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('serves the stale value while one reload runs, then the reloaded one', async () => {
    const clock = new FakeClock()
    let finishReload = (_v: string) => {}
    const load = vi
      .fn()
      .mockResolvedValueOnce('first')
      .mockReturnValueOnce(new Promise<string>(resolve => (finishReload = resolve)))
    const value = new ReloadingValue(1000, load, clock)
    await value.get()

    clock.setCurrentTime(1000)
    expect(await value.get()).toBe('first')
    expect(await value.get()).toBe('first')
    expect(load).toHaveBeenCalledTimes(2)

    finishReload('second')
    await vi.waitFor(async () => expect(await value.get()).toBe('second'))
    expect(load).toHaveBeenCalledTimes(2)
  })

  test('shares one first load between concurrent callers', async () => {
    const load = vi.fn().mockResolvedValue('first')
    const value = new ReloadingValue(1000, load, new FakeClock())

    expect(await Promise.all([value.get(), value.get()])).toEqual(['first', 'first'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  test('tries again on the next call after a failed first load', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('db down')).mockResolvedValue('first')
    const value = new ReloadingValue(1000, load, new FakeClock())

    await expect(value.get()).rejects.toThrow('db down')
    expect(await value.get()).toBe('first')
  })
})

describe('games/game-browse/GameBrowseService', () => {
  beforeEach(() => {
    vi.mocked(getGames).mockImplementation(async params =>
      params.matchup ? [game('race')] : [game(`${params.source ?? 'all'}-${params.format}`)],
    )
  })

  test('adds the race shelf for a viewer who plays a race', async () => {
    vi.mocked(getMostPlayedRanked1v1Race).mockResolvedValue('p')
    const service = new GameBrowseService(new FakeClock())

    const result = await service.getAllGamesShelves(makeSbUserId(1))

    expect(result.yourRace).toBe('p')
    expect(result.shelves.map(s => s.id)).toContain(GameBrowseShelfId.YourRace)
    expect(result.games.map(g => g.id)).toContain('race')
  })

  test('leaves out the race shelf when signed out', async () => {
    const service = new GameBrowseService(new FakeClock())

    const result = await service.getAllGamesShelves(undefined)

    expect(getMostPlayedRanked1v1Race).not.toHaveBeenCalled()
    expect(result.shelves.map(s => s.id)).not.toContain(GameBrowseShelfId.YourRace)
    expect(result.yourRace).toBeUndefined()
  })

  test('leaves out the race shelf when it has no games', async () => {
    vi.mocked(getMostPlayedRanked1v1Race).mockResolvedValue('t')
    vi.mocked(getGames).mockImplementation(async params => (params.matchup ? [] : [game('a')]))
    const service = new GameBrowseService(new FakeClock())

    const result = await service.getAllGamesShelves(makeSbUserId(1))

    expect(result.yourRace).toBeUndefined()
  })

  test('loads the shelves once per period and the map counts once per hour', async () => {
    const clock = new FakeClock()
    const service = new GameBrowseService(clock)

    await service.getAllGamesShelves(undefined)
    await service.getAllGamesShelves(undefined)
    expect(getGames).toHaveBeenCalledTimes(5)
    expect(getTopMapsSince).toHaveBeenCalledTimes(1)

    clock.setCurrentTime(BROWSE_SHELVES_TTL_MS)
    await service.getAllGamesShelves(undefined)
    await vi.waitFor(() => expect(getGames).toHaveBeenCalledTimes(10))
    expect(getTopMapsSince).toHaveBeenCalledTimes(1)

    clock.setCurrentTime(BROWSE_TOP_MAPS_TTL_MS)
    await service.getAllGamesShelves(undefined)
    await vi.waitFor(() => expect(getTopMapsSince).toHaveBeenCalledTimes(2))
  })
})
