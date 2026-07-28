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

/** How long a selection must hold still before we fetch its game — see the debounce note below. */
const MAP_FETCH_DEBOUNCE_MS = 150
/** Initial backoff before retrying a game fetch that failed transiently (rate-limited / 5xx / network). */
const MAP_FETCH_RETRY_MS = 2000
/**
 * Ceiling for the retry backoff. Each transient failure doubles the delay up to this cap, so a
 * sustained 429 settles into an occasional poll rather than a fixed 0.5 req/s hammer for as long as
 * the panel stays open, while still self-healing once the rate limit clears.
 */
const MAP_FETCH_RETRY_MAX_MS = 30000

/**
 * Outcome of each game fetch, tracked across the mount/unmount churn of navigating between replays:
 * `pending` while a request is in flight, `settled` once it has succeeded or terminally failed (a
 * 4xx other than 429 we won't retry). This lets the hook tell "still loading" apart from "no map to
 * show" even for a game the Redux store doesn't have — a distinction the store alone can't make,
 * since a game that's genuinely missing on the server is also simply absent from it.
 *
 * A transient failure (429 rate-limiting, 5xx, network blip) deletes the entry so the fetch can be
 * retried; a terminal outcome writes `settled` so revisiting the replay won't refetch it.
 *
 * This is an external store rather than Redux/component state so the outcome survives a hook
 * unmounting and remounting (arrowing off a replay and back), and it's read through
 * `useSyncExternalStore` below — not a `forceUpdate` reading this map during render — so the React
 * Compiler can't memoize the derived `status` on its reactive inputs and skip a status-only change.
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled'>()

/**
 * Current retry backoff (ms) for each game that has failed transiently and not yet settled. Kept at
 * module scope, keyed by game id, so the backoff *holds* across the hook remounting: arrowing off a
 * rate-limited replay and back doesn't reset it to the initial 2s, so a sustained 429 keeps backing
 * off toward the cap instead of restarting the poll from scratch on every visit. Cleared once the
 * fetch settles (success or terminal failure).
 */
const gameFetchBackoff = new Map<string, number>()

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

function getGameFetchStatus(gameId: string | undefined): 'pending' | 'settled' | undefined {
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
  // The fetch outcome lives in the module-level store above rather than Redux, so it's read here as
  // an external store. This (not a forceUpdate) is what keeps `status` correct under the React
  // Compiler: `fetchStatus` is a tracked reactive input, so the compiler can't memoize the `status`
  // derivation on `[map, gameId, game]` and skip recomputing it when only the fetch outcome changed.
  const fetchStatus = useSyncExternalStore(
    onChange => subscribeToGameFetch(gameId, onChange),
    () => getGameFetchStatus(gameId),
  )

  useEffect(() => {
    // Nothing to fetch: no selection, or the game (and thus its map) is already in the store. Also
    // bail while a request is in flight or has settled — the subscription above delivers its outcome
    // and re-renders us, so scheduling here too would just duplicate the request. Re-running on a
    // transient failure (which deletes the marker) is what schedules the retry.
    if (!gameId || game || gameFetchStatus.has(gameId)) return () => {}

    let canceled = false
    // A fresh selection is debounced so holding the arrow key through the list doesn't fire a request
    // per intermediate selection — each is a different game, so request coalescing can't help (it
    // only dedupes concurrent requests for the *same* game), and the burst trips the server's rate
    // limiter. A game that failed transiently instead waits its persisted backoff, so a returning or
    // re-attaching selection retries no faster than the backoff, rather than resetting to the
    // debounce.
    const delay = gameFetchBackoff.get(gameId) ?? MAP_FETCH_DEBOUNCE_MS
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
            gameFetchBackoff.delete(gameId)
            notifyGameFetchListeners(gameId)
          },
          onError: err => {
            const status = isFetchError(err) ? err.status : undefined
            if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
              // Terminal: the game genuinely has no viewable record, so settle and show the
              // placeholder rather than retrying forever.
              gameFetchStatus.set(gameId, 'settled')
              gameFetchBackoff.delete(gameId)
            } else {
              // Transient (429 rate-limiting, 5xx, network blip): drop the marker so the fetch can be
              // retried, and grow the backoff toward the cap. Notifying re-renders whichever hook is
              // *currently* mounted for this game; that hook's effect re-runs and owns the retry — so
              // a request started by a selection the user has since navigated away from still recovers
              // on a returning mount, instead of stranding it on the loading skeleton.
              gameFetchStatus.delete(gameId)
              const prev = gameFetchBackoff.get(gameId)
              gameFetchBackoff.set(
                gameId,
                prev === undefined
                  ? MAP_FETCH_RETRY_MS
                  : Math.min(prev * 2, MAP_FETCH_RETRY_MAX_MS),
              )
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
  } else if (gameId && !game && fetchStatus !== 'settled') {
    // The game (and its map) is still on the way — debouncing, in flight, or awaiting a retry.
    // Assume a map is coming rather than flashing the "no map" placeholder.
    status = 'loading'
  } else {
    status = 'unavailable'
  }

  return { map, status }
}
