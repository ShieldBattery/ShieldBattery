import { RefObject, useLayoutEffect } from 'react'
import { useLocation } from 'wouter'
import { useLocationProperty } from 'wouter/use-browser-location'
import { useStableCallback } from '../react/state-hooks'
import { getHistoryEntryKey } from './history-entry-key'
import { replace } from './routing'
import { createViewStateStore } from './view-state-store'

/**
 * A hook that reads a search param with a given name from `window.location`, and allows changing
 * it. Changing the search param will re-render the component.
 *
 * If there are multiple params with the same name (which is apparently supported by the standard),
 * we return the first one.
 *
 * @example
 *
 * export const UserList = () => {
 *   // /users?page=3
 *   const [page, setPage] = useLocationSearchParam('page')
 *   console.log(page) // '3'
 *   return <button onClick={() => setPage('4')}>Go to page 4</button>
 * }
 */
export const useLocationSearchParam = (
  name: string,
  transitionFn = replace,
): [value: string, setValue: (value: string) => void] => {
  const searchValue =
    useLocationProperty(() => new URLSearchParams(window.location.search).get(name)) ?? ''

  const setLocationSearch = useStableCallback((value: string) => {
    const searchParams = new URLSearchParams(window.location.search)
    if (value) {
      searchParams.set(name, value)
    } else {
      searchParams.delete(name)
    }

    const searchString = searchParams.toString()
    transitionFn(window.location.pathname + (searchString ? `?${searchString}` : ''))
  })

  return [searchValue, setLocationSearch]
}

/**
 * Resets an element's scroll position to the top whenever the current location's pathname changes.
 * This runs pre-paint, so the user never sees the intermediate scrolled state. Intended for
 * scrollable containers that stay mounted across navigations (e.g. route containers that are keyed
 * by route pattern and thus reused when moving between two locations matching the same pattern),
 * which would otherwise carry the previous page's scroll position over to the new page.
 *
 * Changes to the URL's search params alone don't trigger a reset, so components using the URL as
 * state (e.g. `useLocationSearchParam`) can update it freely without scrolling their page.
 */
export function useScrollResetOnNavigate(ref: RefObject<Element | null>): void {
  const [pathname] = useLocation()

  useLayoutEffect(() => {
    ref.current?.scrollTo(0, 0)
  }, [pathname, ref])
}

const SCROLL_MEMORY_MAX_AGE_MS = 30 * 60 * 1000

const scrollPositions = createViewStateStore<number>('scroll', {
  maxAgeMs: SCROLL_MEMORY_MAX_AGE_MS,
})

/**
 * Returns the current history entry's visit key, re-evaluating whenever a pushState, replaceState,
 * or popstate can have changed which entry is current.
 */
function useHistoryEntryKey(): string | undefined {
  return useLocationProperty(() => getHistoryEntryKey())
}

/**
 * Remembers the scroll position of an element and restores it pre-paint, mirroring the browser's
 * own scroll restoration: positions are keyed per history entry (per "visit"), so traversing back
 * or forward to an entry resumes where the user left off, while following a link to a page visited
 * earlier lands at the top, the same as a fresh visit would. Pushes that keep the same pathname
 * (an overlay opened on top of the current page, a search-param update) and all replaces
 * (in-place URL corrections) share the current visit key, so scroll continuity holds across those.
 * An entry whose `history.state` holds an app-provided value has no visit key, and the hook does
 * nothing while such an entry is current. Positions expire after 30 minutes and old entries fall
 * out of a bounded shared store.
 *
 * Intended for scrollers rendered by a page component *inside* `CenteredContentContainer`-style
 * containers whose built-in reset fires first: this hook's restore runs in the page's own layout
 * effect, which fires after effects of components the page renders, so the restore wins over the
 * reset with no visible flicker.
 *
 * The saved value comes from a scroll listener rather than reading `scrollTop` in the cleanup
 * because, when navigation reuses the mounted page (same route pattern, different params), React
 * has already committed the new page's DOM by the time the cleanup runs, so the element's live
 * `scrollTop` may have been clamped by the new (possibly shorter or still-loading) content. Scroll
 * events dispatch asynchronously, so the value the listener captured last is always from before
 * that swap.
 *
 * Restoring into content that is currently shorter than the saved position clamps naturally;
 * nothing re-restores if the content later grows.
 */
export function useScrollMemory(ref: RefObject<Element | null>): void {
  const entryKey = useHistoryEntryKey()

  useLayoutEffect(() => {
    const elem = ref.current
    if (!elem || entryKey === undefined) {
      return undefined
    }

    let lastScrollTop = scrollPositions.get(entryKey)
    if (lastScrollTop) {
      elem.scrollTo(0, lastScrollTop)
    }

    const onScroll = () => {
      lastScrollTop = elem.scrollTop
    }
    elem.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      elem.removeEventListener('scroll', onScroll)
      if (lastScrollTop !== undefined) {
        scrollPositions.set(entryKey, lastScrollTop)
      }
    }
  }, [entryKey, ref])
}
