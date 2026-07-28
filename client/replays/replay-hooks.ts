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
 * Transient failures (429 rate-limiting, 5xx, network blips) drop their entry so a retry can run.
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled'>()

export function useSbGameMap(gameId: string | undefined): SbGameMapResult {
  const dispatch = useAppDispatch()
  const game = useAppSelector(s => (gameId ? s.games.byId.get(gameId) : undefined))
  const map = useAppSelector(s => (game?.mapId ? s.maps.byId.get(game.mapId) : undefined))
  // A terminal fetch failure only updates the module-level bookkeeping above (the store is left
  // untouched), so it wouldn't trigger a render on its own; this forces one so `status` recomputes.
  const forceUpdate = useReducer(x => x + 1, 0)[1]

  useEffect(() => {
    if (!gameId || game || gameFetchStatus.has(gameId)) return () => {}

    let canceled = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let retryDelay = MAP_FETCH_RETRY_MS

    const attempt = () => {
      if (canceled || gameFetchStatus.has(gameId)) return
      gameFetchStatus.set(gameId, 'pending')
      // Deliberately no abort on unmount/reselection: the response is tiny and caching it in the
      // store is the point. `canceled` just stops us scheduling further retries once we've moved on.
      dispatch(
        viewGame(gameId, {
          onSuccess: () => {
            gameFetchStatus.set(gameId, 'settled')
          },
          onError: err => {
            const status = isFetchError(err) ? err.status : undefined
            if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
              // Terminal: the game genuinely has no viewable record, so settle and show the
              // placeholder rather than retrying forever.
              gameFetchStatus.set(gameId, 'settled')
              forceUpdate()
            } else {
              // Transient (429 rate-limiting, 5xx, network blip): drop the marker unconditionally so
              // a later mount can retry (a failure that lands after we've moved on must not leave the
              // entry stuck at 'pending', which would strand a returning selection on the skeleton),
              // and only schedule our own retry if we're still the active selection. Back off
              // exponentially so a sustained rate-limit resolves on its own without hammering.
              gameFetchStatus.delete(gameId)
              if (!canceled) {
                retryTimer = setTimeout(attempt, retryDelay)
                retryDelay = Math.min(retryDelay * 2, MAP_FETCH_RETRY_MAX_MS)
              }
            }
          },
        }),
      )
    }

    // Debounce the first attempt so holding the arrow key through the list doesn't fire a request
    // per intermediate selection — each is a different game, so request coalescing can't help (it
    // only dedupes concurrent requests for the *same* game), and the burst trips the server's rate
    // limiter. Cached games skip this entirely: they return above with the map already resolved.
    const debounceTimer = setTimeout(attempt, MAP_FETCH_DEBOUNCE_MS)

    return () => {
      canceled = true
      clearTimeout(debounceTimer)
      if (retryTimer) clearTimeout(retryTimer)
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
