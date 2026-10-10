import { useEffect, useState } from 'react'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { SbLobbyId } from '../../common/lobbies/sb-lobby-id'
import { fetchJson } from '../network/fetch'
import { FetchBudget } from '../network/fetch-budget'
import { isFetchError } from '../network/fetch-errors'

/** The load state of a per-lobby fetch (see {@link LobbyFetchCache}). */
export type LobbyLoadState<T> =
  | { status: 'loaded'; data: T }
  | { status: 'notFound' }
  | { status: 'error' }

/** How long a cached fetch is shared between callers that opt into caching. */
const CACHE_MS = 30 * 1000

/**
 * Fetches one kind of per-lobby data (e.g. a lobby's summary), either directly or, with
 * `cached: true`, through a short-lived cache shared by every caller that opts in.
 *
 * Caching exists for call sites where the same lobby can be requested many times at once (e.g. the
 * same lobby link appearing in several rendered chat messages, or a full message list remounting on
 * a channel switch) -- collapsing those into one request per lobby per window avoids fanning out
 * to the endpoint's throttle. A transient failure (anything other than a 404) isn't cached, so a
 * later caller retries instead of being stuck with the error for the whole window; a 404 is cached
 * like any other result, since a lobby that's gone stays gone.
 *
 * Cache-missing cached reads also draw from `budget`, which bounds how many requests content the
 * user didn't write (message text is sender-controlled) can make on their behalf.
 */
export class LobbyFetchCache<T> {
  private readonly entries = new Map<
    SbLobbyId,
    { expiresAt: number; promise: Promise<LobbyLoadState<T>> }
  >()

  constructor(
    private readonly urlFor: (lobbyId: SbLobbyId) => string,
    private readonly budget: FetchBudget,
  ) {}

  /**
   * Fetches the data for `lobbyId`. Without `cached`, `signal` aborts the request the same way it
   * would a plain `fetchJson` call.
   */
  fetch(
    lobbyId: SbLobbyId,
    options: { cached?: false; signal?: AbortSignal } | { cached: true } = {},
  ): Promise<LobbyLoadState<T>> {
    if (!options.cached) {
      return fetchJson<T>(this.urlFor(lobbyId), { signal: options.signal }).then(
        (data): LobbyLoadState<T> => ({ status: 'loaded', data }),
        (err): LobbyLoadState<T> =>
          isFetchError(err) && err.status === 404 ? { status: 'notFound' } : { status: 'error' },
      )
    }

    const now = Date.now()
    const cached = this.entries.get(lobbyId)
    if (cached && cached.expiresAt > now) {
      return cached.promise
    }

    // Sweep other expired entries out while we're here -- they're otherwise only replaced when the
    // same lobby is requested again, so the cache would grow unbounded over a long session.
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(id)
      }
    }

    if (!this.budget.take(now)) {
      // Over-budget reads fail as transient errors without touching the network. The denial isn't
      // cached, so a denied reader that remounts (e.g. its channel is reopened) reads again against
      // whatever budget exists at that point.
      return Promise.resolve({ status: 'error' })
    }

    const promise: Promise<LobbyLoadState<T>> = fetchJson<T>(this.urlFor(lobbyId)).then(
      (data): LobbyLoadState<T> => {
        // The shared window starts when the response arrives, not when the request started, so a
        // slow fetch doesn't eat into it.
        const entry = this.entries.get(lobbyId)
        if (entry?.promise === promise) {
          entry.expiresAt = Date.now() + CACHE_MS
        }
        return { status: 'loaded', data }
      },
      (err): LobbyLoadState<T> => {
        if (isFetchError(err) && err.status === 404) {
          return { status: 'notFound' }
        }
        // Evict only our own entry: a request that outlives its window may fail after a later
        // caller has already repopulated the cache with a fresh in-flight fetch.
        if (this.entries.get(lobbyId)?.promise === promise) {
          this.entries.delete(lobbyId)
        }
        return { status: 'error' }
      },
    )
    this.entries.set(lobbyId, { expiresAt: now + CACHE_MS, promise })
    return promise
  }

  /** Clears the cache and restores the fetch budget, so tests don't depend on each other. */
  reset() {
    this.entries.clear()
    this.budget.reset()
  }
}

/**
 * Loads `lobbyId`'s data through `cache`. Returns a tuple of the load state (undefined while the
 * fetch for the current `lobbyId` is in flight, or while `lobbyId` is undefined) and a `refresh`
 * function that re-runs the fetch for the current `lobbyId`.
 *
 * The result is tagged with the lobby id it was fetched for, so a stale result from a previous id
 * (e.g. if `lobbyId` changes without the caller unmounting) is never rendered as current -- the
 * state stays undefined until a result tagged with the current id arrives. A `refresh` doesn't
 * clear the existing result, so the previous state remains rendered until the new one lands. If a
 * refresh fails for a reason other than a 404, the last successfully loaded data is kept instead
 * of being downgraded to the error state.
 *
 * Pass `cached: true` to read through the cache's shared window instead of always hitting the
 * network -- appropriate for call sites where the same lobby can be requested many times at once
 * and eventually-consistent data is fine. Note that caching makes `refresh` effectively a no-op for
 * the rest of the cache window: it re-runs the read, but the read is handed the same cached result
 * back. Leave `cached` unset for a single authoritative view (e.g. the join preview) that should
 * always see the current state and control its own refreshes.
 */
export function useLobbyFetch<T>(
  cache: LobbyFetchCache<T>,
  lobbyId: SbLobbyId | undefined,
  options?: { cached?: boolean },
): [state: LobbyLoadState<T> | undefined, refresh: () => void] {
  const cached = options?.cached ?? false
  const [result, setResult] = useState<{ lobbyId: SbLobbyId; state: LobbyLoadState<T> }>()
  const [refreshToken, setRefreshToken] = useState(0)

  useEffect(() => {
    if (!lobbyId) {
      return undefined
    }

    const applyState = (state: LobbyLoadState<T>) =>
      setResult(prev =>
        // A lobby that's still loadable shouldn't lose its rendered details to a transient
        // failure; only a 404 (definitively gone) replaces loaded data. Every refresh gets a fresh
        // chance to fail, so this is what keeps rendered data on screen across one.
        state.status === 'error' && prev?.lobbyId === lobbyId && prev.state.status === 'loaded'
          ? prev
          : { lobbyId, state },
      )

    if (cached) {
      // The fetch itself is shared across every mount currently requesting this lobby, so it can't
      // be aborted just because this particular mount goes away -- only ignore a result that
      // arrives after that happens.
      let canceled = false
      cache
        .fetch(lobbyId, { cached: true })
        .then(state => {
          if (!canceled) {
            applyState(state)
          }
        })
        .catch(swallowNonBuiltins)

      return () => {
        canceled = true
      }
    }

    const controller = new AbortController()

    cache
      .fetch(lobbyId, { signal: controller.signal })
      .then(state => {
        if (controller.signal.aborted) {
          return
        }
        applyState(state)
      })
      .catch(swallowNonBuiltins)

    return () => controller.abort()
  }, [cache, lobbyId, refreshToken, cached])

  const refresh = () => setRefreshToken(t => t + 1)

  return [lobbyId && result?.lobbyId === lobbyId ? result.state : undefined, refresh]
}
