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
/** Base backoff before the first retry of a game fetch that failed transiently (rate-limited / 5xx / network). */
const MAP_FETCH_RETRY_MS = 2000
/**
 * Ceiling for the retry backoff. Each transient failure doubles the delay up to this cap, so a
 * sustained 429 settles into an occasional poll rather than a fixed 0.5 req/s hammer for as long as
 * the panel stays open, while still self-healing once the rate limit clears.
 */
const MAP_FETCH_RETRY_MAX_MS = 30000
/**
 * How many times a single game fetch may fail transiently before we stop retrying and show the
 * placeholder. Without a cap a *persistently* failing fetch — a long outage, or a non-`FetchError`
 * thrown while dispatching (which has no status and so is treated as transient) — would shimmer the
 * hero and poll forever with no terminal fallback. With the backoff above, six attempts span roughly
 * a minute before giving up. Giving up is *recoverable*, not permanent — see `gaveUp` below.
 */
const MAP_FETCH_MAX_ATTEMPTS = 6

/**
 * Outcome of each game fetch, tracked across the mount/unmount churn of navigating between replays.
 * This lets the hook tell "still loading" apart from "no map to show" even for a game the Redux store
 * doesn't have — a distinction the store alone can't make, since a game that's genuinely missing on
 * the server is also simply absent from it.
 *
 * - `pending`: a request is in flight.
 * - `settled`: terminally resolved — the game loaded, or it 4xx'd (other than 429), so there's
 *   genuinely no viewable record. Revisiting won't refetch.
 * - `gaveUp`: exhausted its transient retries (`MAP_FETCH_MAX_ATTEMPTS`). Shown as unavailable and no
 *   longer polled, but — unlike `settled` — *not* permanent: a transient outage shouldn't strand the
 *   preview for the rest of the session. Any later successful fetch (proof the limiter/network
 *   recovered) clears every `gaveUp` marker so those games refetch when next shown.
 *
 * A transient failure short of the cap deletes the entry instead, so the fetch is retried.
 *
 * This is an external store rather than Redux/component state so the outcome survives a hook
 * unmounting and remounting (arrowing off a replay and back), and it's read through
 * `useSyncExternalStore` below — not a `forceUpdate` reading this map during render — so the React
 * Compiler can't memoize the derived `status` on its reactive inputs and skip a status-only change.
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled' | 'gaveUp'>()

/**
 * Number of times each not-yet-resolved game fetch has failed transiently. Kept at module scope,
 * keyed by game id, so it *holds* across the hook remounting: arrowing off a rate-limited replay and
 * back derives the same backoff instead of resetting to the initial 2s, so a sustained 429 keeps
 * backing off toward the cap rather than restarting the poll on every visit. Also drives the attempt
 * cap above.
 *
 * Cleared *entirely* on any successful fetch — a success proves the limiter/network isn't blocking,
 * so every game's accrued backoff is void (a game we backed off from won't stall on a long-expired
 * 30s delay when revisited). That a concurrent success also resets a still-failing game's count is
 * intended: the cap is a safety net for a *sustained* no-success outage, not a limiter on a burst
 * that's already clearing.
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
    // bail on any tracked outcome — a request in flight (`pending`), a terminal one (`settled`), or a
    // gave-up one (`gaveUp`): the subscription above delivers a `pending` request's result and
    // re-renders us, and the resolved/gave-up states shouldn't refetch. Re-running on a transient
    // failure (which deletes the marker) is what schedules the retry.
    if (!gameId || game || gameFetchStatus.has(gameId)) return () => {}

    let canceled = false
    // A fresh selection is debounced so holding the arrow key through the list doesn't fire a request
    // per intermediate selection — each is a different game, so request coalescing can't help (it
    // only dedupes concurrent requests for the *same* game), and the burst trips the server's rate
    // limiter. A game that has already failed transiently instead waits an exponential backoff
    // derived from its (persisted) failure count, so a returning or re-attaching selection retries no
    // faster than the backoff, rather than resetting to the debounce.
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
            // A success proves the limiter/network recovered, so let every game that gave up try
            // again (dropping its marker means the next time it's shown it refetches) and void every
            // game's accrued backoff — otherwise a game we backed off from would stall on a stale 30s
            // delay, or a gave-up game would stay "unavailable" for the rest of the session.
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
              // Terminal: the game genuinely has no viewable record, so settle permanently and show
              // the placeholder rather than retrying.
              gameFetchStatus.set(gameId, 'settled')
              gameFetchRetries.delete(gameId)
            } else if (attempts >= MAP_FETCH_MAX_ATTEMPTS) {
              // Exhausted our transient retries (a sustained outage / rate-limit / persistently
              // throwing fetch): stop shimmering — and polling — and show the placeholder. Recoverable
              // rather than permanent (see `gaveUp`): a later successful fetch reopens it.
              gameFetchStatus.set(gameId, 'gaveUp')
              gameFetchRetries.delete(gameId)
            } else {
              // Transient (429 rate-limiting, 5xx, network blip, non-`FetchError` throw): drop the
              // marker so the fetch can be retried, and bump the failure count (which grows the
              // backoff toward the cap). Notifying re-renders whichever hook is *currently* mounted
              // for this game; that hook's effect re-runs and owns the retry — so a request started by
              // a selection the user has since navigated away from still recovers on a returning
              // mount, instead of stranding it on the loading skeleton.
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
    // The game (and its map) is still on the way — debouncing, in flight, or awaiting a retry.
    // Assume a map is coming rather than flashing the "no map" placeholder. Once the fetch resolves
    // (`settled`) or gives up (`gaveUp`), fall through to the placeholder.
    status = 'loading'
  } else {
    status = 'unavailable'
  }

  return { map, status }
}

/**
 * Clears the module-level fetch bookkeeping. Exported for tests only, so each case starts from a
 * clean slate instead of leaking `pending`/`settled` markers, backoff counts, and listeners into the
 * next one (the state deliberately outlives any single hook mount, so it isn't reset otherwise).
 */
export function resetSbGameMapStateForTests() {
  gameFetchStatus.clear()
  gameFetchRetries.clear()
  gameFetchListeners.clear()
}
