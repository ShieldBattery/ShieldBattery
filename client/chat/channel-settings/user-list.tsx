import { debounce } from 'lodash-es'
import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { elevationPlus1 } from '../../material/shadows'
import { useRefreshToken } from '../../network/refresh-token'
import { SearchInput } from '../../search/search-input'
import { ContainerLevel, containerStyles } from '../../styles/colors'
import { bodyLarge, labelMedium, singleLine, titleSmall } from '../../styles/typography'
import { ConnectedUsername } from '../../users/connected-username'

/*
 * Shared building blocks for channel settings tabs that show a searchable, infinitely-scrolled
 * list of users (the channel members on the permissions tab, the banned users on the bans tab).
 */

/** Date format for the secondary date line on user list cards (join date, ban date). */
export const userListDateFormat = new Intl.DateTimeFormat(navigator.language, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
})

export const UserListRoot = styled.div`
  display: flex;
  flex-direction: column;
  gap: 16px;
`

export const UserListSearchResults = styled.div`
  width: 100%;

  display: flex;
  flex-direction: column;
  gap: 8px;
`

export const UserListNoResults = styled.div`
  ${bodyLarge};

  color: var(--theme-on-surface-variant);
`

export const UserListSearchInput = styled(SearchInput)`
  width: 256px;
`

export const UserListCardRow = styled.div`
  ${elevationPlus1};
  ${containerStyles(ContainerLevel.Low)};

  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  border-radius: 4px;
  overflow: hidden;
`

export const UserListCardActions = styled.div`
  flex-shrink: 0;
  padding-right: 8px;
  display: flex;
  align-items: center;
`

export const UserListCardInfo = styled.div`
  flex-grow: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`

export const UserListCardUsername = styled(ConnectedUsername)`
  ${titleSmall};
  ${singleLine};
`

/** Secondary line of text on a user list card (join/ban dates, ban reasons, and similar). */
export const UserListCardSubtitle = styled.div`
  ${labelMedium};
  ${singleLine};
  color: var(--theme-on-surface-variant);
`

export interface UserListPage<T> {
  entries: T[]
  hasMore: boolean
}

/**
 * Manages the state behind a searchable, infinitely-scrolled user list: the loaded entries, a
 * debounced search query that resets them, and the abort/dedupe handling around page loads.
 */
export function useSearchableUserList<T>({
  loadPage,
  getEntryKey,
}: {
  /**
   * Called when the list wants the next page for the current query. Implementations should issue
   * the network request (aborting it if `signal` fires) and report the outcome through
   * `onSuccess`/`onError`.
   */
  loadPage: (opts: {
    searchQuery: string
    offset: number
    signal: AbortSignal
    onSuccess: (page: UserListPage<T>) => void
    onError: (err: Error) => void
  }) => void
  /** Returns a stable identity for an entry, used to dedupe entries across page loads. */
  getEntryKey: (entry: T) => unknown
}): {
  entries: T[] | undefined
  setEntries: Dispatch<SetStateAction<T[] | undefined>>
  hasMore: boolean
  isLoadingMore: boolean
  searchError: Error | undefined
  searchQuery: string
  refreshToken: number
  onSearchChange: (query: string) => void
  onLoadMore: () => void
} {
  const [entries, setEntries] = useState<T[]>()
  const [hasMore, setHasMore] = useState(true)

  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [searchError, setSearchError] = useState<Error>()
  const [searchQuery, setSearchQuery] = useState('')
  const abortControllerRef = useRef<AbortController>(undefined)

  const [refreshToken, triggerRefresh] = useRefreshToken()
  // Clears the loaded entries and lets the infinite scroll list initiate a fresh network request.
  const reset = () => {
    // TODO(2Pac): Make the infinite scroll list in charge of the loading state, so we don't have
    // to do this here, which is pretty unintuitive.
    setIsLoadingMore(false)
    setSearchError(undefined)
    setEntries(undefined)
    setHasMore(true)
    triggerRefresh()
  }
  const debouncedSearchRef = useRef(
    debounce((query: string) => {
      setSearchQuery(query)
      reset()
    }, 100),
  )

  const onSearchChange = (query: string) => {
    debouncedSearchRef.current(query)
  }

  const onLoadMore = () => {
    setIsLoadingMore(true)
    setSearchError(undefined)

    abortControllerRef.current?.abort()
    abortControllerRef.current = new AbortController()

    loadPage({
      searchQuery,
      offset: entries?.length ?? 0,
      signal: abortControllerRef.current.signal,
      onSuccess: page => {
        setIsLoadingMore(false)
        setEntries(prev => {
          const existing = prev ?? []
          // Dedupe against what we already have: server-side ordering can shift between page
          // loads (e.g. an entry being edited or re-placed), letting an entry cross a page
          // boundary and reappear in a later page.
          const seenKeys = new Set(existing.map(getEntryKey))
          return existing.concat(page.entries.filter(entry => !seenKeys.has(getEntryKey(entry))))
        })
        setHasMore(page.hasMore)
      },
      onError: err => {
        setIsLoadingMore(false)
        setSearchError(err)
      },
    })
  }

  useEffect(() => {
    const debouncedSearch = debouncedSearchRef.current
    return () => {
      abortControllerRef.current?.abort()
      debouncedSearch.cancel()
    }
  }, [])

  return {
    entries,
    setEntries,
    hasMore,
    isLoadingMore,
    searchError,
    searchQuery,
    refreshToken,
    onSearchChange,
    onLoadMore,
  }
}
