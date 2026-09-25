import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GameConfigPlayer, GameSource } from '../../common/games/configuration'
import { GameType } from '../../common/games/game-type'
import { GameRecordJson } from '../../common/games/games'
import { makeSeasonId, MatchmakingSeasonJson } from '../../common/matchmaking'
import { asMockedFunction } from '../../common/testing/mocks'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { dispatch } from '../dispatch-registry'
import { fetchJson } from '../network/fetch'
import { FetchError } from '../network/fetch-errors'
import {
  collapseMatchupSide,
  findSeasonAt,
  getMatchupColumns,
  getMatchupHeight,
  getVersusSides,
  loadGameForLink,
  loadMatchmakingSeasons,
  resetGameLinkFetchesForTesting,
} from './game-link-card'

vi.mock('../network/fetch', () => ({
  fetchJson: vi.fn(),
}))
vi.mock('../dispatch-registry', () => ({
  dispatch: vi.fn(),
}))

const fetchJsonMock = asMockedFunction(fetchJson)
const dispatchMock = asMockedFunction(dispatch)

function notFoundError(): FetchError {
  return new FetchError(new Response('', { status: 404, statusText: 'Not Found' }), '')
}

function serverError(): FetchError {
  return new FetchError(new Response('', { status: 500, statusText: 'Server Error' }), '')
}

function player(id: number): GameConfigPlayer {
  return { id: makeSbUserId(id), race: 'p', isComputer: false }
}

function makeGame(
  gameType: GameType,
  teams: ReadonlyArray<ReadonlyArray<GameConfigPlayer>>,
): GameRecordJson {
  return {
    id: 'game',
    config: {
      gameSource: GameSource.Lobby,
      gameSourceExtra: undefined,
      gameType,
      gameSubType: 0,
      teams,
    },
  } as unknown as GameRecordJson
}

/** Players `from` through `to` inclusive. */
function players(from: number, to: number): GameConfigPlayer[] {
  return Array.from({ length: to - from + 1 }, (_, i) => player(from + i))
}

const ROW_HEIGHT = 20
const ROW_GAP = 8
const rowsHeight = (rows: number) => rows * ROW_HEIGHT + (rows - 1) * ROW_GAP

describe('client/games/game-link-card/loadGameForLink', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    resetGameLinkFetchesForTesting()
    fetchJsonMock.mockReset()
    dispatchMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('shares one request across concurrent loads of the same game', async () => {
    fetchJsonMock.mockResolvedValue({ game: { id: 'a' } })

    const results = await Promise.all([loadGameForLink('a'), loadGameForLink('a')])

    expect(results).toEqual([undefined, undefined])
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  test('refetches a game that loaded, since the store is its cache', async () => {
    fetchJsonMock.mockResolvedValue({ game: { id: 'a' } })

    await loadGameForLink('a')
    await loadGameForLink('a')

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  test('caches a 404', async () => {
    fetchJsonMock.mockRejectedValue(notFoundError())

    expect(await loadGameForLink('a')).toBe('notFound')
    expect(await loadGameForLink('a')).toBe('notFound')
    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).not.toHaveBeenCalled()
  })

  test('evicts other failures so a later load retries', async () => {
    fetchJsonMock.mockRejectedValueOnce(serverError())
    fetchJsonMock.mockResolvedValueOnce({ game: { id: 'a' } })

    expect(await loadGameForLink('a')).toBe('error')
    expect(await loadGameForLink('a')).toBeUndefined()
    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
  })

  test('denies loads past the budget without caching the denial', async () => {
    fetchJsonMock.mockResolvedValue({ game: {} })

    for (let i = 0; i < 10; i++) {
      expect(await loadGameForLink(`game-${i}`)).toBeUndefined()
    }
    expect(await loadGameForLink('over-budget')).toBe('error')
    expect(fetchJsonMock).toHaveBeenCalledTimes(10)

    vi.advanceTimersByTime(30 * 1000)
    expect(await loadGameForLink('over-budget')).toBeUndefined()
    expect(fetchJsonMock).toHaveBeenCalledTimes(11)
  })

  test('joins an in-flight load without spending budget', async () => {
    let resolve: (value: unknown) => void = () => {}
    fetchJsonMock.mockReturnValueOnce(new Promise(r => (resolve = r)))
    const pending = loadGameForLink('shared')
    fetchJsonMock.mockResolvedValue({ game: {} })
    for (let i = 0; i < 9; i++) {
      await loadGameForLink(`game-${i}`)
    }

    const joined = loadGameForLink('shared')
    resolve({ game: {} })

    expect(await Promise.all([pending, joined])).toEqual([undefined, undefined])
    expect(fetchJsonMock).toHaveBeenCalledTimes(10)
  })
})

describe('client/games/game-link-card/matchup layout', () => {
  test('treats a 1v1 recorded as a single team as a head-to-head', () => {
    const game = makeGame(GameType.Melee, [[player(1), player(2)]])
    expect(getVersusSides(game)).toEqual([[player(1)], [player(2)]])
  })

  test('ignores an empty observer team in a 1v1', () => {
    const game = makeGame(GameType.OneVsOne, [[player(1), player(2)], []])
    expect(getVersusSides(game)).toEqual([[player(1)], [player(2)]])
  })

  test("doesn't split a free for all into two sides", () => {
    const game = makeGame(GameType.FreeForAll, [players(1, 4)])
    expect(getVersusSides(game)).toBeUndefined()
    const columns = getMatchupColumns(game, p => `player-${p.id}`)
    expect(columns.map(c => c.length)).toEqual([2, 2])
  })

  test('keeps the teams of a Top vs Bottom game as its sides', () => {
    const game = makeGame(GameType.TopVsBottom, [players(1, 5), players(6, 8)])
    expect(getVersusSides(game)?.map(side => side.length)).toEqual([5, 3])
  })

  test('sizes a Top vs Bottom game to its larger team', () => {
    expect(
      getMatchupHeight(makeGame(GameType.TopVsBottom, [players(1, 3), players(4, 4)]), 'medium'),
    ).toBe(rowsHeight(3))
  })

  test('caps the height of an uneven Top vs Bottom game with a side longer than it fits', () => {
    for (const top of [5, 6, 7]) {
      const game = makeGame(GameType.TopVsBottom, [players(1, top), players(top + 1, 8)])
      expect(getMatchupHeight(game, 'medium')).toBe(rowsHeight(4))
    }
  })

  test('collapses a side longer than the matchup fits into a "+N more" row', () => {
    expect(collapseMatchupSide([1, 2, 3, 4])).toEqual({ shown: [1, 2, 3, 4], hiddenCount: 0 })
    expect(collapseMatchupSide([1, 2, 3, 4, 5])).toEqual({ shown: [1, 2, 3], hiddenCount: 2 })
    expect(collapseMatchupSide([1, 2, 3, 4, 5, 6, 7])).toEqual({
      shown: [1, 2, 3],
      hiddenCount: 4,
    })
  })
})

describe('client/games/game-link-card/loadMatchmakingSeasons', () => {
  beforeEach(() => {
    resetGameLinkFetchesForTesting()
    fetchJsonMock.mockReset()
    dispatchMock.mockReset()
  })

  test('fetches the seasons once per session', async () => {
    fetchJsonMock.mockResolvedValue({ seasons: [], current: makeSeasonId(1) })

    await Promise.all([loadMatchmakingSeasons(), loadMatchmakingSeasons()])
    await loadMatchmakingSeasons()

    expect(fetchJsonMock).toHaveBeenCalledTimes(1)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })

  test('retries after a failure', async () => {
    fetchJsonMock.mockRejectedValueOnce(serverError())
    fetchJsonMock.mockResolvedValueOnce({ seasons: [], current: makeSeasonId(1) })

    await loadMatchmakingSeasons()
    expect(dispatchMock).not.toHaveBeenCalled()
    await loadMatchmakingSeasons()

    expect(fetchJsonMock).toHaveBeenCalledTimes(2)
    expect(dispatchMock).toHaveBeenCalledTimes(1)
  })
})

describe('client/games/game-link-card/findSeasonAt', () => {
  function season(id: number, startDate: number, endDate?: number): MatchmakingSeasonJson {
    return { id: makeSeasonId(id), name: `Season ${id}`, startDate, endDate, resetMmr: false }
  }

  const SEASONS = [season(3, 3000), season(2, 2000, 3000), season(1, 1000, 2000)]

  test('finds the season running at a time', () => {
    expect(findSeasonAt(SEASONS, 2500)?.id).toBe(makeSeasonId(2))
    expect(findSeasonAt(SEASONS, 9000)?.id).toBe(makeSeasonId(3))
  })

  test("places a season's end in the next season", () => {
    expect(findSeasonAt(SEASONS, 2000)?.id).toBe(makeSeasonId(2))
    expect(findSeasonAt(SEASONS, 3000)?.id).toBe(makeSeasonId(3))
  })

  test('finds nothing before the first season or when its season is missing', () => {
    expect(findSeasonAt(SEASONS, 500)).toBeUndefined()
    expect(findSeasonAt([season(3, 3000)], 2500)).toBeUndefined()
  })
})
