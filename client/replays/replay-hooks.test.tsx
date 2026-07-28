import { act, renderHook } from '@testing-library/react'
import { ReactNode } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { GameRecordJson } from '../../common/games/games'
import type { MapInfoJson } from '../../common/maps'
import createStore from '../create-store'
import type { RequestHandlingSpec } from '../network/abortable-thunk'
import { FetchError } from '../network/fetch-errors'
import {
  MAP_FETCH_COALESCE_MS as COALESCE_MS,
  MAP_FETCH_MAX_ATTEMPTS as MAX_ATTEMPTS,
  MAP_FETCH_RETRY_MAX_MS as RETRY_MAX_MS,
  MAP_FETCH_RETRY_MS as RETRY_MS,
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

function failLatest(gameId: string, status: number) {
  act(() => {
    latestSpec(gameId).onError(new FetchError(new Response(null, { status }), ''))
  })
}

function succeedLatest(gameId: string) {
  act(() => {
    latestSpec(gameId).onSuccess(undefined)
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
    // between cases — otherwise markers/backoff/listeners leak from one test into the next.
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

  test('resolves to unavailable on a terminal 4xx without retrying', () => {
    const { result } = renderMap('terminal-game')
    expect(result.current.status).toBe('loading')

    advance(COALESCE_MS)
    expect(specCountFor('terminal-game')).toBe(1)

    failLatest('terminal-game', 404)
    expect(result.current.status).toBe('unavailable')

    advance(RETRY_MS * 4)
    expect(specCountFor('terminal-game')).toBe(1)
  })

  test('retries a transient failure with exponential backoff', () => {
    const { result } = renderMap('flaky-game')

    advance(COALESCE_MS)
    expect(specCountFor('flaky-game')).toBe(1)

    failLatest('flaky-game', 429)
    expect(result.current.status).toBe('loading')

    // First retry after ~2s.
    advance(RETRY_MS)
    expect(specCountFor('flaky-game')).toBe(2)

    failLatest('flaky-game', 500)
    // Backoff doubles to ~4s, so nothing fires at 2s...
    advance(RETRY_MS)
    expect(specCountFor('flaky-game')).toBe(2)
    // ...and the next attempt lands by 4s.
    advance(RETRY_MS)
    expect(specCountFor('flaky-game')).toBe(3)
  })

  test('refetches when returning to a replay whose fetch failed after moving on', () => {
    const first = renderMap('left-game')
    advance(COALESCE_MS)
    expect(specCountFor('left-game')).toBe(1)

    // Navigate away entirely before the request resolves, then let it fail transiently with nobody
    // mounted to hear it.
    first.unmount()
    failLatest('left-game', 429)

    // Coming back mounts fresh and fetches again rather than sticking on the skeleton forever. The
    // transient failure while away left a live backoff for this game, so the return waits it out
    // rather than resetting to the initial debounce.
    const second = renderMap('left-game')
    expect(second.result.current.status).toBe('loading')
    advance(COALESCE_MS)
    expect(specCountFor('left-game')).toBe(1)
    advance(RETRY_MS)
    expect(specCountFor('left-game')).toBe(2)
  })

  test('holds the retry backoff across arrowing off the replay and back', () => {
    const { rerender } = renderMap('storm-game')
    advance(COALESCE_MS)
    expect(specCountFor('storm-game')).toBe(1)

    // Two transient failures grow the backoff to ~4s (2s doubled).
    failLatest('storm-game', 429)
    advance(RETRY_MS)
    expect(specCountFor('storm-game')).toBe(2)
    failLatest('storm-game', 429)

    // Arrow away and back while backed off. The backoff is per-game module state, so it must persist
    // rather than resetting to the initial 2s.
    rerender({ gameId: 'elsewhere' })
    advance(COALESCE_MS)
    rerender({ gameId: 'storm-game' })

    // Still backed off: nothing refires at 2s...
    advance(RETRY_MS)
    expect(specCountFor('storm-game')).toBe(2)
    // ...but the next attempt lands by the held ~4s backoff.
    advance(RETRY_MS)
    expect(specCountFor('storm-game')).toBe(3)
  })

  test('clears all backoff on a successful fetch so a backed-off game refetches promptly', () => {
    const { rerender } = renderMap('backed-off')
    advance(COALESCE_MS)
    expect(specCountFor('backed-off')).toBe(1)

    // Two failures grow this game's backoff to ~4s.
    failLatest('backed-off', 429)
    advance(RETRY_MS)
    expect(specCountFor('backed-off')).toBe(2)
    failLatest('backed-off', 429)

    // A different game's fetch then succeeds — the limiter clearly isn't blocking anymore.
    rerender({ gameId: 'ok-game' })
    advance(COALESCE_MS)
    succeedLatest('ok-game')

    // Returning to the backed-off game now fetches on the debounce, not the stale ~4s backoff.
    rerender({ gameId: 'backed-off' })
    advance(COALESCE_MS)
    expect(specCountFor('backed-off')).toBe(3)
  })

  // The wait before each successive attempt on a game that keeps failing — debounce, then the
  // doubling backoff, capped — derived from the same constants (and formula) the hook uses so it
  // can't drift out of sync with them.
  const ATTEMPT_DELAYS = Array.from({ length: MAX_ATTEMPTS }, (_, i) =>
    i === 0 ? COALESCE_MS : Math.min(RETRY_MS * 2 ** (i - 1), RETRY_MAX_MS),
  )

  function exhaustRetries(gameId: string, result: { current: { status: string } }) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      advance(ATTEMPT_DELAYS[attempt - 1])
      expect(specCountFor(gameId)).toBe(attempt)
      expect(result.current.status).toBe('loading')
      failLatest(gameId, 429)
    }
  }

  test('gives up to unavailable after exhausting transient retries, and stops polling', () => {
    const { result } = renderMap('doomed')
    exhaustRetries('doomed', result)

    // The final failure exhausts the cap: the hero stops shimmering and falls back to unavailable...
    expect(result.current.status).toBe('unavailable')
    // ...and there are no further retries, however long the panel stays open.
    advance(RETRY_MAX_MS * 2)
    expect(specCountFor('doomed')).toBe(MAX_ATTEMPTS)
  })

  test('reopens a gave-up game after a later successful fetch, rather than stranding it', () => {
    const gaveUp = renderMap('gave-up')
    exhaustRetries('gave-up', gaveUp.result)
    expect(gaveUp.result.current.status).toBe('unavailable')

    // A later fetch on another game succeeds — proof the limiter/network recovered.
    gaveUp.rerender({ gameId: 'healthy' })
    advance(COALESCE_MS)
    succeedLatest('healthy')

    // Returning to the gave-up game now refetches instead of staying stuck on the placeholder.
    gaveUp.rerender({ gameId: 'gave-up' })
    expect(gaveUp.result.current.status).toBe('loading')
    advance(COALESCE_MS)
    expect(specCountFor('gave-up')).toBe(MAX_ATTEMPTS + 1)
  })

  test('recovers when re-attaching to an in-flight fetch that then fails transiently', () => {
    const { result, rerender } = renderMap('reattach-game')

    // Kick off the fetch for the first selection and leave it in flight.
    advance(COALESCE_MS)
    expect(specCountFor('reattach-game')).toBe(1)

    // Arrow to another replay and back while the first request is still outstanding.
    rerender({ gameId: 'other-game' })
    advance(COALESCE_MS)
    rerender({ gameId: 'reattach-game' })

    // Re-attached to the still-'pending' fetch: no duplicate request, still showing the skeleton.
    expect(result.current.status).toBe('loading')
    expect(specCountFor('reattach-game')).toBe(1)

    // The original in-flight request finally fails transiently. The re-attached mount — not the
    // original, canceled requester — must own the retry, or the panel is stranded on 'loading'.
    failLatest('reattach-game', 429)
    expect(result.current.status).toBe('loading')

    advance(RETRY_MS)
    expect(specCountFor('reattach-game')).toBe(2)
  })
})
