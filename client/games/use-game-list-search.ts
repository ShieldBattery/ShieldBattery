import { useEffect, useRef, useState } from 'react'
import { ReadonlyDeep } from 'type-fest'
import { GameRecordJson } from '../../common/games/games'
import { useRefreshToken } from '../network/refresh-token'
import { useAppSelector } from '../redux-hooks'

/** A single page of game ids, as returned by a `useGameListSearch` caller's `loadPage`. */
export interface GameListSearchPage {
  gameIds: string[]
  hasMoreGames: boolean
}

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
 */
export function useGameListSearch(
  loadPage: (offset: number, signal: AbortSignal) => Promise<GameListSearchPage>,
): UseGameListSearchResult {
  const [gameIds, setGameIds] = useState<string[]>()
  const [hasMoreGames, setHasMoreGames] = useState(true)
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

  return { games, hasMoreGames, isLoadingMore, searchError, refreshToken, reset, onLoadMore }
}
