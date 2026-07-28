import { useEffect, useSyncExternalStore } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { viewGame } from '../games/action-creators'
import { isFetchError } from '../network/fetch-errors'
import { useAppDispatch, useAppSelector } from '../redux-hooks'

export type SbGameMapStatus = 'loading' | 'loaded' | 'unavailable'

export interface SbGameMapResult {
  map: ReadonlyDeep<MapInfoJson> | undefined
  /**
   * `loading` while the backing game (and thus its map) is still being fetched, `loaded` once the
   * map is resolved, `unavailable` when there's genuinely no map to show (a replay with no linked
   * SB game, or a game whose map has been deleted / can't be found).
   */
  status: SbGameMapStatus
}

/** How long a selection must hold still before we fetch its game (see the debounce in the effect). */
const MAP_FETCH_DEBOUNCE_MS = 150
/** Base backoff before the first retry of a transiently-failed fetch (rate-limited / 5xx / network). */
const MAP_FETCH_RETRY_MS = 2000
/** Backoff ceiling: a sustained failure polls at most this often while the panel stays open. */
const MAP_FETCH_RETRY_MAX_MS = 30000
/**
 * Transient failures a fetch may take before it gives up (see `gaveUp`) rather than shimmering and
 * polling forever. With the backoff above, ~a minute.
 */
const MAP_FETCH_MAX_ATTEMPTS = 6

/**
 * Fetch outcome per game id, tracked at module scope so it survives the hook unmounting/remounting as
 * the user arrows between replays. Lets the hook distinguish "still loading" from "no map" even for a
 * game absent from the Redux store (a genuinely missing game is also simply absent from it).
 *
 * - `pending`: a request is in flight.
 * - `settled`: terminally resolved — loaded, or a 4xx (other than 429) with no viewable record.
 *   Permanent; revisiting won't refetch.
 * - `gaveUp`: exhausted its transient retries. Shown as unavailable and no longer polled, but — unlike
 *   `settled` — recoverable: any later successful fetch clears every `gaveUp`, so a transient outage
 *   doesn't strand the preview for the rest of the session.
 *
 * A transient failure short of the cap deletes the entry instead, so the fetch is retried.
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled' | 'gaveUp'>()

/**
 * Transient-failure count per not-yet-resolved game, driving both the backoff delay and the attempt
 * cap. At module scope so the backoff holds across remounts (arrowing away and back doesn't reset it
 * to 2s). Cleared entirely on any success — proof the limiter/network recovered — which voids stale
 * backoffs and keeps the cap a safety net for a sustained outage, not a limiter on a clearing burst.
 */
const gameFetchRetries = new Map<string, number>()

/** Hooks subscribed to a given game id's fetch outcome, notified whenever it changes. */
const gameFetchListeners = new Map<string, Set<() => void>>()

function subscribeToGameFetch(gameId: string | undefined, onChange: () => void): () => void {
  if (!gameId) return () => {}
  const listeners = gameFetchListeners.get(gameId) ?? new Set<() => void>()
  gameFetchListeners.set(gameId, listeners)
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0) {
      gameFetchListeners.delete(gameId)
    }
  }
}

function getGameFetchStatus(
  gameId: string | undefined,
): 'pending' | 'settled' | 'gaveUp' | undefined {
  return gameId ? gameFetchStatus.get(gameId) : undefined
}

function notifyGameFetchListeners(gameId: string) {
  const listeners = gameFetchListeners.get(gameId)
  if (!listeners) return
  // Copy first: a listener may (un)subscribe as a side effect of the re-render it triggers.
  for (const listener of [...listeners]) {
    listener()
  }
}

export function useSbGameMap(gameId: string | undefined): SbGameMapResult {
  const dispatch = useAppDispatch()
  const game = useAppSelector(s => (gameId ? s.games.byId.get(gameId) : undefined))
  const map = useAppSelector(s => (game?.mapId ? s.maps.byId.get(game.mapId) : undefined))
  // Read the module-level outcome as an external store. useSyncExternalStore (a tracked reactive
  // input) rather than a forceUpdate keeps `status` correct under the React Compiler, which could
  // otherwise memoize the derivation on `[map, gameId, game]` and skip a status-only change.
  const fetchStatus = useSyncExternalStore(
    onChange => subscribeToGameFetch(gameId, onChange),
    () => getGameFetchStatus(gameId),
  )

  useEffect(() => {
    // Nothing to schedule: no selection, the game is already in the store, or the fetch has a tracked
    // outcome (a `pending` request delivers its result via the subscription; `settled`/`gaveUp` don't
    // refetch). A transient failure deletes the marker, and re-running here is what retries.
    if (!gameId || game || gameFetchStatus.has(gameId)) return () => {}

    let canceled = false
    // Debounce a fresh selection so holding the arrow key doesn't fire a request per intermediate
    // replay (each is a different game, so request coalescing can't help). A game that's already
    // failed waits its backoff instead, so a returning/re-attaching selection retries no faster than
    // the backoff.
    const retries = gameFetchRetries.get(gameId) ?? 0
    const delay =
      retries === 0
        ? MAP_FETCH_DEBOUNCE_MS
        : Math.min(MAP_FETCH_RETRY_MS * 2 ** (retries - 1), MAP_FETCH_RETRY_MAX_MS)
    const timer = setTimeout(() => {
      if (canceled || gameFetchStatus.has(gameId)) return
      gameFetchStatus.set(gameId, 'pending')
      notifyGameFetchListeners(gameId)
      // Deliberately no abort on unmount/reselection: the response is tiny and caching it in the
      // store is the point.
      dispatch(
        viewGame(gameId, {
          onSuccess: () => {
            gameFetchStatus.set(gameId, 'settled')
            // Recovery: a success proves the limiter/network is back, so reopen every gave-up game
            // (deleting its marker → refetches when next shown) and void all accrued backoff.
            for (const id of [...gameFetchStatus.keys()]) {
              if (gameFetchStatus.get(id) === 'gaveUp') {
                gameFetchStatus.delete(id)
                notifyGameFetchListeners(id)
              }
            }
            gameFetchRetries.clear()
            notifyGameFetchListeners(gameId)
          },
          onError: err => {
            const status = isFetchError(err) ? err.status : undefined
            const terminal4xx =
              status !== undefined && status >= 400 && status < 500 && status !== 429
            const attempts = (gameFetchRetries.get(gameId) ?? 0) + 1
            if (terminal4xx) {
              // No viewable record — settle permanently.
              gameFetchStatus.set(gameId, 'settled')
              gameFetchRetries.delete(gameId)
            } else if (attempts >= MAP_FETCH_MAX_ATTEMPTS) {
              // Retries exhausted — give up (recoverable): stop shimmering and polling.
              gameFetchStatus.set(gameId, 'gaveUp')
              gameFetchRetries.delete(gameId)
            } else {
              // Transient (429 / 5xx / network / non-`FetchError` throw): drop the marker and bump the
              // count. Notifying lets whichever hook is *currently* mounted own the retry, so a fetch
              // started by a since-abandoned selection still recovers on a returning mount rather than
              // stranding it on the skeleton.
              gameFetchStatus.delete(gameId)
              gameFetchRetries.set(gameId, attempts)
            }
            notifyGameFetchListeners(gameId)
          },
        }),
      )
    }, delay)

    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [gameId, game, dispatch, fetchStatus])

  let status: SbGameMapStatus
  if (map) {
    status = 'loaded'
  } else if (gameId && !game && (fetchStatus === undefined || fetchStatus === 'pending')) {
    // Still on the way (debouncing / in flight / awaiting retry): assume a map is coming rather than
    // flashing the placeholder. `settled`/`gaveUp` fall through to unavailable.
    status = 'loading'
  } else {
    status = 'unavailable'
  }

  return { map, status }
}

/**
 * Clears the module-level fetch bookkeeping. Exported for tests only — the state deliberately outlives
 * a hook mount, so it must be reset between cases to stop markers/counts/listeners leaking.
 */
export function resetSbGameMapStateForTests() {
  gameFetchStatus.clear()
  gameFetchRetries.clear()
  gameFetchListeners.clear()
}
