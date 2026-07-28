import { act, renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GameRecordJson } from '../../common/games/games'
import type { MapInfoJson } from '../../common/maps'
import createStore from '../create-store'
import type { RequestHandlingSpec } from '../network/abortable-thunk'
import {
  MAP_FETCH_COALESCE_MS as COALESCE_MS,
  resetSbGameMapStateForTests,
  useSbGameMap,
} from './replay-hooks'

// Mock out the real game fetch so tests drive its outcome by hand. The mock records each spec so a
// test can resolve/reject the "request" whenever it likes, and returns a harmless thunk.
const { viewGameMock, specsByGame } = vi.hoisted(() => {
  const specsByGame = new Map<string, Array<RequestHandlingSpec<unknown>>>()
  const viewGameMock = vi.fn((gameId: string, spec: RequestHandlingSpec<unknown>) => {
    const specs = specsByGame.get(gameId) ?? []
    specs.push(spec)
    specsByGame.set(gameId, specs)
    return () => {}
  })
  return { viewGameMock, specsByGame }
})

vi.mock('../games/action-creators', () => ({
  viewGame: viewGameMock,
}))

let store: ReturnType<typeof createStore>

function wrapper({ children }: { children: ReactNode }) {
  return <ReduxProvider store={store}>{children}</ReduxProvider>
}

function renderMap(gameId: string | undefined) {
  return renderHook(({ gameId }: { gameId: string | undefined }) => useSbGameMap(gameId), {
    initialProps: { gameId },
    wrapper,
  })
}

function specCountFor(gameId: string): number {
  return specsByGame.get(gameId)?.length ?? 0
}

function latestSpec(gameId: string): RequestHandlingSpec<unknown> {
  const specs = specsByGame.get(gameId)
  if (!specs?.length) {
    throw new Error(`no viewGame call recorded for ${gameId}`)
  }
  return specs[specs.length - 1]
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

function failLatest(gameId: string) {
  act(() => {
    latestSpec(gameId).onError(new Error('fetch failed'))
  })
}

// Seeds the store as a `@games/getGameRecord` fetch would, so the game and its map are already
// present (the cached, no-fetch-needed path). Only the fields the hook reads are set.
function seedGameWithMap(gameId: string, mapId: string) {
  act(() => {
    store.dispatch({
      type: '@games/getGameRecord',
      payload: {
        game: { id: gameId, mapId } as GameRecordJson,
        map: { id: mapId } as MapInfoJson,
        users: [],
        mmrChanges: [],
      },
    })
  })
}

describe('client/replays/replay-hooks/useSbGameMap', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    specsByGame.clear()
    viewGameMock.mockClear()
    // The hook's fetch bookkeeping is module-level and deliberately outlives a mount, so reset it
    // between cases — otherwise markers/listeners leak from one test into the next.
    resetSbGameMapStateForTests()
    store = createStore()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('is unavailable and fetches nothing for a replay with no linked game', () => {
    const { result } = renderMap(undefined)
    expect(result.current.status).toBe('unavailable')
    expect(result.current.map).toBeUndefined()

    advance(COALESCE_MS * 2)
    expect(viewGameMock).not.toHaveBeenCalled()
  })

  test('reports loaded from the store without fetching when the game is already cached', () => {
    seedGameWithMap('cached-game', 'cached-map')

    const { result } = renderMap('cached-game')
    expect(result.current.status).toBe('loaded')
    expect(result.current.map?.id).toBe('cached-map')

    advance(COALESCE_MS * 2)
    expect(specCountFor('cached-game')).toBe(0)
  })

  test('fetches a settled selection immediately, with no artificial loading delay', () => {
    const { result } = renderMap('picked')

    // Leading edge: nothing was fetched recently, so a deliberate selection loads at once — no timer
    // advance needed.
    expect(specCountFor('picked')).toBe(1)
    expect(result.current.status).toBe('loading')
  })

  test('coalesces a fast scroll to the replay landed on, without fetching intermediates', () => {
    // A first deliberate selection fetches immediately (leading edge)...
    const { rerender } = renderMap('warm')
    expect(specCountFor('warm')).toBe(1)

    // ...then a scroll whose selections change faster than the coalesce window fetches only the row
    // it settles on, not each intermediate one.
    const step = Math.floor(COALESCE_MS / 3)
    rerender({ gameId: 'skip-1' })
    advance(step)
    rerender({ gameId: 'skip-2' })
    advance(step)
    rerender({ gameId: 'land' })
    advance(COALESCE_MS)

    expect(specCountFor('skip-1')).toBe(0)
    expect(specCountFor('skip-2')).toBe(0)
    expect(specCountFor('land')).toBe(1)
  })

  test('shows unavailable on a fetch error and does not retry', () => {
    const { result } = renderMap('broken')
    expect(specCountFor('broken')).toBe(1)
    expect(result.current.status).toBe('loading')

    failLatest('broken')
    expect(result.current.status).toBe('unavailable')

    // No retry, however long the panel stays open.
    advance(COALESCE_MS * 20)
    expect(specCountFor('broken')).toBe(1)
  })

  test('refetches when returning to a replay whose earlier fetch failed', () => {
    const { rerender } = renderMap('flappy')
    expect(specCountFor('flappy')).toBe(1)
    failLatest('flappy')
    expect(specCountFor('flappy')).toBe(1)

    // Navigate away and back. Leaving drops the settled marker, so returning refetches rather than
    // showing the placeholder for the rest of the session.
    rerender({ gameId: 'other' })
    advance(COALESCE_MS)
    rerender({ gameId: 'flappy' })
    advance(COALESCE_MS)
    expect(specCountFor('flappy')).toBe(2)
  })

  test('re-attaches to an in-flight fetch rather than starting a duplicate', () => {
    const { result, rerender } = renderMap('shared')
    expect(specCountFor('shared')).toBe(1)

    // Arrow away and back while the request is still in flight — no duplicate fetch, still loading.
    rerender({ gameId: 'other' })
    advance(COALESCE_MS)
    rerender({ gameId: 'shared' })
    expect(result.current.status).toBe('loading')
    expect(specCountFor('shared')).toBe(1)

    // When the shared in-flight request finally resolves, the re-attached mount reflects it.
    failLatest('shared')
    expect(result.current.status).toBe('unavailable')
  })
})
