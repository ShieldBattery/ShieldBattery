import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GameRecordJson } from '../../common/games/games'
import { resetViewStateForTesting } from '../navigation/view-state-store'
import { GameListSearchPage, useGameListSearch } from './use-game-list-search'

// The hook only reads `useHistoryEntryKey` from router-hooks, so that's all this mocks. The test
// drives it through a plain module-scope variable rather than a per-test mock return value, since
// the entry key needs to change independently of any particular render.
let currentEntryKey: string | undefined

vi.mock('../navigation/router-hooks', () => ({
  useHistoryEntryKey: () => currentEntryKey,
}))

// The hook only reads `s.games.byId` from the store, so the fake state below is the minimal shape
// that satisfies it; populated per test with stub records for whatever ids the pages return.
const fakeGamesById = new Map<string, GameRecordJson>()

vi.mock('../redux-hooks', () => ({
  useAppSelector: (
    selector: (state: { games: { byId: Map<string, GameRecordJson> } }) => unknown,
  ) => selector({ games: { byId: fakeGamesById } }),
}))

function addStubGames(...ids: string[]) {
  for (const id of ids) {
    fakeGamesById.set(id, { id } as GameRecordJson)
  }
}

interface PendingLoad {
  resolve: (page: GameListSearchPage) => void
  reject: (err: unknown) => void
}

/** A `loadPage` mock whose calls are queued up for the test to resolve/reject one at a time. */
function makeLoadPage() {
  const pending: PendingLoad[] = []
  const loadPage = vi.fn((_offset: number, _signal: AbortSignal): Promise<GameListSearchPage> => {
    return new Promise<GameListSearchPage>((resolve, reject) => {
      pending.push({ resolve, reject })
    })
  })
  return { loadPage, pending }
}

/** Resolves the given pending load and lets its state updates commit before returning. */
async function resolveLoad(load: PendingLoad, page: GameListSearchPage) {
  await act(async () => {
    load.resolve(page)
    await Promise.resolve()
  })
}

describe('client/games/use-game-list-search', () => {
  beforeEach(() => {
    currentEntryKey = undefined
    fakeGamesById.clear()
    resetViewStateForTesting()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('restores the accumulated window on remount under the same entry key, with no refetch', async () => {
    currentEntryKey = 'visit-1'
    addStubGames('g1', 'g2')

    const { loadPage, pending } = makeLoadPage()
    const { result, unmount } = renderHook(() => useGameListSearch(loadPage))

    act(() => {
      result.current.onLoadMore()
    })
    await resolveLoad(pending[0], { gameIds: ['g1', 'g2'], hasMoreGames: true })

    expect(result.current.games.map(g => g.id)).toEqual(['g1', 'g2'])
    unmount()

    const { loadPage: loadPageAfter } = makeLoadPage()
    const { result: remounted } = renderHook(() => useGameListSearch(loadPageAfter))

    expect(remounted.current.games.map(g => g.id)).toEqual(['g1', 'g2'])
    expect(remounted.current.hasMoreGames).toBe(true)
    expect(loadPageAfter).not.toHaveBeenCalled()
  })

  test('starts empty on remount under a different entry key', async () => {
    currentEntryKey = 'visit-1'
    addStubGames('g1')

    const { loadPage, pending } = makeLoadPage()
    const { result, unmount } = renderHook(() => useGameListSearch(loadPage))

    act(() => {
      result.current.onLoadMore()
    })
    await resolveLoad(pending[0], { gameIds: ['g1'], hasMoreGames: false })
    unmount()

    currentEntryKey = 'visit-2'
    const { loadPage: loadPageOther } = makeLoadPage()
    const { result: other } = renderHook(() => useGameListSearch(loadPageOther))

    expect(other.current.games).toEqual([])
    expect(other.current.hasMoreGames).toBe(true)
  })

  test('reset() followed by unmount before the next page resolves deletes the entry', async () => {
    currentEntryKey = 'visit-1'
    addStubGames('g1')

    // Establish a saved window first, so there's something for reset() to actually clear.
    const { loadPage, pending } = makeLoadPage()
    const first = renderHook(() => useGameListSearch(loadPage))
    act(() => {
      first.result.current.onLoadMore()
    })
    await resolveLoad(pending[0], { gameIds: ['g1'], hasMoreGames: true })
    first.unmount()

    // Remount under the same key (restoring the window above), then change filters and leave again
    // before the new filters' first page comes back.
    const { loadPage: loadPageB, pending: pendingB } = makeLoadPage()
    const second = renderHook(() => useGameListSearch(loadPageB))
    expect(second.result.current.games.map(g => g.id)).toEqual(['g1'])

    act(() => {
      second.result.current.reset()
    })
    act(() => {
      second.result.current.onLoadMore()
    })
    expect(pendingB.length).toBe(1)
    second.unmount()

    const { loadPage: loadPageC } = makeLoadPage()
    const third = renderHook(() => useGameListSearch(loadPageC))

    expect(third.result.current.games).toEqual([])
    expect(third.result.current.hasMoreGames).toBe(true)
  })

  test('saves nothing when the entry key is undefined throughout', async () => {
    currentEntryKey = undefined
    addStubGames('g1')

    const { loadPage, pending } = makeLoadPage()
    const { result, unmount } = renderHook(() => useGameListSearch(loadPage))

    act(() => {
      result.current.onLoadMore()
    })
    await resolveLoad(pending[0], { gameIds: ['g1'], hasMoreGames: true })
    unmount()

    const { loadPage: loadPageAfter } = makeLoadPage()
    const { result: other } = renderHook(() => useGameListSearch(loadPageAfter))

    expect(other.current.games).toEqual([])
    expect(other.current.hasMoreGames).toBe(true)
  })

  test('a restored window past its 30-minute TTL is treated as absent', async () => {
    vi.useFakeTimers()
    currentEntryKey = 'visit-1'
    addStubGames('g1')

    const { loadPage, pending } = makeLoadPage()
    const { result, unmount } = renderHook(() => useGameListSearch(loadPage))
    act(() => {
      result.current.onLoadMore()
    })
    await resolveLoad(pending[0], { gameIds: ['g1'], hasMoreGames: true })
    unmount()

    vi.advanceTimersByTime(31 * 60 * 1000)

    const { loadPage: loadPageAfter } = makeLoadPage()
    const { result: other } = renderHook(() => useGameListSearch(loadPageAfter))

    expect(other.current.games).toEqual([])
    expect(other.current.hasMoreGames).toBe(true)
  })
})
