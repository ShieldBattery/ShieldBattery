import { useEffect, useReducer } from 'react'
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
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled'>()

/**
 * Hooks currently mounted for a given game id. When a fetch changes `gameFetchStatus` above it
 * notifies these, so every mounted hook re-renders (recomputing `status`) and — on a transient
 * failure — whichever hook is still mounted owns the retry.
 *
 * This is what lets a selection that *re-attaches* to an already in-flight fetch recover. Arrowing
 * off a replay and back before its request resolves leaves the marker `pending`, so the returning
 * mount parks here instead of starting its own request; if that request then fails transiently, the
 * notification — not the original requester's by-then-canceled closure — is what re-renders it and
 * schedules the retry. Without this the panel would stay stuck on the loading skeleton for the rest
 * of the session, precisely in the fast-scroll / 429 scenario the debounce exists to handle.
 */
const gameFetchListeners = new Map<string, Set<() => void>>()

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
  // Fetch outcomes update the module-level bookkeeping above rather than the store, so they wouldn't
  // trigger a render on their own; this forces one so `status` recomputes.
  const forceUpdate = useReducer(x => x + 1, 0)[1]

  useEffect(() => {
    if (!gameId || game) return () => {}

    let canceled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let retryDelay = MAP_FETCH_RETRY_MS

    const attempt = () => {
      // A fetch for this game is already in flight or settled (started by our own earlier attempt,
      // an earlier selection of the same replay, or another mount): don't duplicate it — the
      // listener below delivers its outcome.
      if (canceled || gameFetchStatus.has(gameId)) return
      gameFetchStatus.set(gameId, 'pending')
      // Deliberately no abort on unmount/reselection: the response is tiny and caching it in the
      // store is the point.
      dispatch(
        viewGame(gameId, {
          onSuccess: () => {
            gameFetchStatus.set(gameId, 'settled')
            notifyGameFetchListeners(gameId)
          },
          onError: err => {
            const status = isFetchError(err) ? err.status : undefined
            if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
              // Terminal: the game genuinely has no viewable record, so settle and show the
              // placeholder rather than retrying forever.
              gameFetchStatus.set(gameId, 'settled')
            } else {
              // Transient (429 rate-limiting, 5xx, network blip): drop the marker so the fetch can be
              // retried. We don't schedule the retry here — the notification lets whichever hook is
              // *currently* mounted own it, which matters when this request was started by a
              // selection the user has since navigated away from (this closure is canceled and would
              // schedule nothing, stranding a returning mount on the skeleton).
              gameFetchStatus.delete(gameId)
            }
            notifyGameFetchListeners(gameId)
          },
        }),
      )
    }

    const onFetchStatusChange = () => {
      if (canceled) return
      forceUpdate()
      // A transient failure cleared the marker and we still need the map: own the retry, backing off
      // exponentially so a sustained rate-limit settles into an occasional poll rather than a fixed
      // 0.5 req/s hammer for as long as the panel stays open.
      if (!gameFetchStatus.has(gameId)) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(attempt, retryDelay)
        retryDelay = Math.min(retryDelay * 2, MAP_FETCH_RETRY_MAX_MS)
      }
    }

    const listeners = gameFetchListeners.get(gameId) ?? new Set<() => void>()
    gameFetchListeners.set(gameId, listeners)
    listeners.add(onFetchStatusChange)

    // Debounce the first attempt so holding the arrow key through the list doesn't fire a request
    // per intermediate selection — each is a different game, so request coalescing can't help (it
    // only dedupes concurrent requests for the *same* game), and the burst trips the server's rate
    // limiter. Skipped when a fetch is already in flight/settled for this game (a cached game returns
    // above with the map resolved; a re-attaching selection waits for the listener's outcome).
    if (!gameFetchStatus.has(gameId)) {
      timer = setTimeout(attempt, MAP_FETCH_DEBOUNCE_MS)
    }

    return () => {
      canceled = true
      if (timer) clearTimeout(timer)
      listeners.delete(onFetchStatusChange)
      if (listeners.size === 0) {
        gameFetchListeners.delete(gameId)
      }
    }
  }, [gameId, game, dispatch, forceUpdate])

  let status: SbGameMapStatus
  if (map) {
    status = 'loaded'
  } else if (gameId && !game && gameFetchStatus.get(gameId) !== 'settled') {
    // The game (and its map) is still on the way — debouncing, in flight, or awaiting a retry.
    // Assume a map is coming rather than flashing the "no map" placeholder.
    status = 'loading'
  } else {
    status = 'unavailable'
  }

  return { map, status }
}
