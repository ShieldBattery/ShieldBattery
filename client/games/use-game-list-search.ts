import { useEffect, useRef, useState } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson } from '../../common/games/games'
import { useHistoryEntryKey } from '../navigation/router-hooks'
import { createViewStateStore } from '../navigation/view-state-store'
import { useRefreshToken } from '../network/refresh-token'
import { useAppSelector } from '../redux-hooks'

/** A single page of game ids, as returned by a `useGameListSearch` caller's `loadPage`. */
export interface GameListSearchPage {
  gameIds: string[]
  hasMoreGames: boolean
}

// TTL must match useScrollMemory's: the saved scroll position and the saved window restore
// together, and a scroll restored into a missing window would clamp against a single fresh page.
// Both are stamped when the user leaves the page.
const WINDOW_MAX_AGE_MS = 30 * 60 * 1000

interface GameListWindow {
  gameIds: string[]
  hasMoreGames: boolean
}

const windowCache = createViewStateStore<GameListWindow>('game-list', {
  maxAgeMs: WINDOW_MAX_AGE_MS,
})

export interface UseGameListSearchResult {
  games: ReadonlyArray<ReadonlyDeep<GameRecordJson>>
  hasMoreGames: boolean
  isLoadingMore: boolean
  searchError?: Error
  /** Bumped on every `reset()`; pass through to `InfiniteScrollList`'s `refreshToken` prop. */
  refreshToken: number
  /** Aborts any in-flight page load, clears the accumulated results, and bumps `refreshToken`. */
  reset: () => void
  /** Loads the next page (called by `InfiniteScrollList`'s `onLoadNextData`). */
  onLoadMore: () => void
}

/**
 * Shared offset-paging search logic for a games list backed by the global `games.byId` store.
 * Accumulates game ids across pages (deduping on append, since the underlying window can shift —
 * e.g. new games completing, or a user's match history changing between page loads — and re-serve
 * rows already loaded), aborts any in-flight page load on `reset()` or unmount, and tracks the
 * loading/error state a caller's `InfiniteScrollList` needs.
 *
 * Callers own their own filter/URL-param state and provide `loadPage`, which should fetch a single
 * page (e.g. by dispatching a thunk) for a given offset and resolve with the ids of the games it
 * returned plus whether more pages remain. Once `signal` has been aborted, this hook ignores
 * whatever `loadPage`'s returned promise eventually does (matching how `abortableThunk` itself
 * skips `onSuccess`/`onError` for a canceled request), so a stale response from a superseded page
 * load never corrupts the accumulated results.
 *
 * The accumulated window is remembered per history entry (per "visit"), mirroring `useScrollMemory`:
 * traversing back or forward to an entry resumes the list it had accumulated with no refetch, while
 * a fresh link push starts empty. A restored window is exactly as stale as it was when the user left
 * — like the browser's own back/forward cache — and the next `onLoadMore` simply continues paging
 * from its end. The cached ids stay resolvable because `games.byId` never evicts entries within a
 * session.
 */
export function useGameListSearch(
  loadPage: (offset: number, signal: AbortSignal) => Promise<GameListSearchPage>,
): UseGameListSearchResult {
  const entryKey = useHistoryEntryKey()
  // Read once per mount: the store contract allows a lazy initializer since it runs at most once
  // and so never re-reads on a re-render.
  const [initialWindow] = useState(() =>
    entryKey !== undefined ? windowCache.get(entryKey) : undefined,
  )

  const [gameIds, setGameIds] = useState<string[] | undefined>(initialWindow?.gameIds)
  const [hasMoreGames, setHasMoreGames] = useState(initialWindow?.hasMoreGames ?? true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const abortControllerRef = useRef<AbortController>(undefined)
  const [refreshToken, triggerRefresh] = useRefreshToken()

  // The (stable) map is selected and the list is derived in render rather than inside the
  // selector, which would return a fresh array on every store update and re-render the whole list
  // on any Redux action. react-compiler memoizes the derivation below.
  const gamesById = useAppSelector(s => s.games.byId)
  const games = gameIds?.map(id => gamesById.get(id)!) ?? []

  const reset = () => {
    abortControllerRef.current?.abort()
    setGameIds(undefined)
    setHasMoreGames(true)
    setIsLoadingMore(false)
    setSearchError(undefined)
    triggerRefresh()
  }

  const onLoadMore = () => {
    setIsLoadingMore(true)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()
    const { signal } = abortControllerRef.current

    loadPage(gameIds?.length ?? 0, signal).then(
      page => {
        if (signal.aborted) return

        setIsLoadingMore(false)
        // This is a moving window, so a later page can re-serve rows from an earlier one. Dedupe
        // on concat to avoid duplicate React keys / repeated rows.
        setGameIds(prev => {
          const existingIds = new Set(prev ?? [])
          return (prev ?? []).concat(page.gameIds.filter(id => !existingIds.has(id)))
        })
        setHasMoreGames(page.hasMoreGames)
        setSearchError(undefined)
      },
      (err: Error) => {
        if (signal.aborted) return

        setIsLoadingMore(false)
        setSearchError(err)
      },
    )
  }

  useEffect(() => {
    return () => abortControllerRef.current?.abort()
  }, [])

  useEffect(() => {
    if (entryKey === undefined) {
      return undefined
    }

    // Written at cleanup time (unmount), not as `gameIds`/`hasMoreGames` change: the store stamps
    // its TTL at write time, and this needs to match when `useScrollMemory` saves the scroll
    // position — also at unmount — so the two entries expire together. Writing on every data change
    // instead would stamp the last page load, which can be long before the user actually leaves,
    // letting the window expire while the scroll position it's paired with still lives.
    return () => {
      if (gameIds !== undefined) {
        windowCache.set(entryKey, { gameIds, hasMoreGames })
      } else {
        // `reset()` (a filter change) clears `gameIds` while replacing the URL in place under the
        // same visit key. If the user leaves before the first page under the new filters arrives,
        // the old filters' entry must not survive to be restored against the new URL.
        windowCache.delete(entryKey)
      }
    }
  }, [entryKey, gameIds, hasMoreGames])

  return { games, hasMoreGames, isLoadingMore, searchError, refreshToken, reset, onLoadMore }
}
