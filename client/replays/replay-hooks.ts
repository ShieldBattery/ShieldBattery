import { useEffect, useSyncExternalStore } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { MapInfoJson } from '../../common/maps'
import { viewGame } from '../games/action-creators'
import { useAppDispatch, useAppSelector } from '../redux-hooks'

export type SbGameMapStatus = 'loading' | 'loaded' | 'unavailable'

export interface SbGameMapResult {
  map: ReadonlyDeep<MapInfoJson> | undefined
  /**
   * `loading` while the backing game (and thus its map) is still being fetched, `loaded` once the
   * map is resolved, `unavailable` when there's genuinely no map to show (a replay with no linked
   * SB game, a game whose map has been deleted / can't be found, or a fetch that failed).
   */
  status: SbGameMapStatus
}

/**
 * Coalescing window for rapid selection changes. A deliberate selection fetches immediately (leading
 * edge — no artificial delay on the normal click-through-the-list case); only while selections keep
 * changing faster than this (a fast scroll / held arrow) does the fetch wait for the list to settle,
 * so an intermediate replay you blow past doesn't fire its own request.
 */
export const MAP_FETCH_COALESCE_MS = 150

/**
 * Per-game fetch outcome, tracked at module scope so it survives the hook re-rendering as the user
 * arrows between replays. Lets the hook tell "still loading" apart from "no map to show" even for a
 * game absent from the Redux store (a genuinely missing game is also simply absent from it):
 * `pending` while a request is in flight, `settled` once it has resolved — loaded, no map, or a
 * failed fetch (all of which show the placeholder rather than shimmering).
 *
 * A `settled` marker is dropped when the user navigates away (see the cleanup effect below), so
 * returning to a replay whose fetch failed transiently refetches rather than showing the placeholder
 * for the rest of the session. Read through `useSyncExternalStore` (not a `forceUpdate` reading this
 * map during render) so the React Compiler can't memoize the derived `status` on its reactive inputs
 * and skip a status-only change.
 */
const gameFetchStatus = new Map<string, 'pending' | 'settled'>()

/**
 * `Date.now()` when the last fetch was kicked off, across all games — used to tell a deliberate
 * selection (fetch immediately) from one made mid-scroll, still within `MAP_FETCH_COALESCE_MS` of the
 * previous fetch (debounce it so a fast scroll only fetches the row it lands on).
 */
let lastFetchStartedAt = 0

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
  // Read the module-level outcome as an external store. useSyncExternalStore (a tracked reactive
  // input) rather than a forceUpdate keeps `status` correct under the React Compiler, which could
  // otherwise memoize the derivation on `[map, gameId, game]` and skip a status-only change.
  const fetchStatus = useSyncExternalStore(
    onChange => subscribeToGameFetch(gameId, onChange),
    () => getGameFetchStatus(gameId),
  )

  useEffect(() => {
    // Nothing to schedule: no selection, the game is already in the store, or a fetch is in flight /
    // has settled (the subscription above delivers a pending fetch's result; a settled one shouldn't
    // refetch while it's shown — the cleanup effect reopens it on the way out).
    if (!gameId || game || gameFetchStatus.has(gameId)) return () => {}

    let canceled = false
    const attempt = () => {
      if (canceled || gameFetchStatus.has(gameId)) return
      lastFetchStartedAt = Date.now()
      gameFetchStatus.set(gameId, 'pending')
      notifyGameFetchListeners(gameId)
      // Deliberately no abort on unmount/reselection: the response is tiny and caching it in the
      // store is the point.
      dispatch(
        viewGame(gameId, {
          onSuccess: () => {
            gameFetchStatus.set(gameId, 'settled')
            notifyGameFetchListeners(gameId)
          },
          onError: () => {
            // Any failure (no viewable record, a 429, a 5xx, a network blip) settles to the
            // placeholder — like every other panel, a failed fetch just shows the empty state. No
            // retry; the cleanup effect lets a later reselect try again.
            gameFetchStatus.set(gameId, 'settled')
            notifyGameFetchListeners(gameId)
          },
        }),
      )
    }

    if (Date.now() - lastFetchStartedAt >= MAP_FETCH_COALESCE_MS) {
      // Leading edge: nothing's been fetched within the coalesce window, so this is a deliberate
      // selection — fetch at once, no artificial delay.
      attempt()
      return () => {
        canceled = true
      }
    }

    // Trailing edge: selections are changing faster than the coalesce window (a fast scroll), so wait
    // for this one to settle, coalescing the run down to the row landed on.
    const timer = setTimeout(attempt, MAP_FETCH_COALESCE_MS)
    return () => {
      canceled = true
      clearTimeout(timer)
    }
  }, [gameId, game, dispatch, fetchStatus])

  useEffect(() => {
    return () => {
      // On leaving this replay, drop a settled marker so returning refetches — a transient failure
      // shouldn't strand the preview for the session (a success is cached in the store regardless). A
      // still-pending fetch is left in place so a quick return re-attaches to it.
      if (gameId !== undefined && gameFetchStatus.get(gameId) === 'settled') {
        gameFetchStatus.delete(gameId)
      }
    }
  }, [gameId])

  let status: SbGameMapStatus
  if (map) {
    status = 'loaded'
  } else if (gameId && !game && fetchStatus !== 'settled') {
    // Still on the way (coalescing / in flight): assume a map is coming rather than flashing the
    // placeholder. A settled outcome (loaded, no map, or a failed fetch) falls through to unavailable.
    status = 'loading'
  } else {
    status = 'unavailable'
  }

  return { map, status }
}

/**
 * Clears the module-level fetch bookkeeping. Exported for tests only — the state deliberately outlives
 * a hook mount, so it must be reset between cases to stop markers and listeners leaking.
 */
export function resetSbGameMapStateForTests() {
  gameFetchStatus.clear()
  gameFetchListeners.clear()
  lastFetchStartedAt = 0
}
