import { RefObject, useLayoutEffect, useState } from 'react'
import { StateSnapshot } from 'react-virtuoso'
import { useHistoryEntryKey } from './router-hooks'
import { createViewStateStore } from './view-state-store'

interface VirtuosoScrollState {
  /** Scroll offset of the scroll container itself, including any content above the list. */
  scrollTop: number
  /** Virtuoso's own state snapshot (item sizes + list-relative scroll), if the list was mounted. */
  snapshot?: StateSnapshot
}

const SCROLL_MEMORY_MAX_AGE_MS = 30 * 60 * 1000

const scrollStates = createViewStateStore<VirtuosoScrollState>('virtuoso-scroll', {
  maxAgeMs: SCROLL_MEMORY_MAX_AGE_MS,
})

/** The subset of the react-virtuoso handle types (VirtuosoHandle, TableVirtuosoHandle, …) needed to capture a state snapshot. */
interface VirtuosoStateHandle {
  getState(stateCb: (state: StateSnapshot) => void): void
}

/**
 * Remembers the scroll position of a `customScrollParent`-driven react-virtuoso list and restores
 * it, mirroring `useScrollMemory`'s per-history-entry semantics: positions are keyed by history
 * entry (per "visit"), so traversing back or forward to an entry resumes where the user left off,
 * while a fresh visit — including one that reuses an already-mounted component, such as a pathname
 * push from switching tabs — starts at the top. A container like the ladder table stays mounted
 * across those in-app navigations, so without keying the reset to the visit, switching tabs would
 * carry the previous tab's scroll offset over into the new one.
 *
 * Unlike `useScrollMemory`, this can't just call `scrollTo` on mount: on a fresh mount of a
 * virtualized list, no rows have been measured yet, so the scroll container's `scrollHeight` is
 * still small and a pre-paint `scrollTo` to a deep offset clamps back to (near) zero before
 * virtuoso ever gets a chance to render the rows that would justify that height. React-virtuoso
 * solves exactly this with its state snapshot: feeding one back in via the `restoreStateFrom` prop
 * seeds the measured item sizes before the first paint, so virtuoso's very first render already
 * lays out the right rows at the full list height and applies the snapshot's scroll offset itself.
 * This hook returns such a snapshot (or `undefined` when there's nothing to restore) for the
 * caller to pass straight through as `restoreStateFrom`. The snapshot's offset is relative to the
 * top of the *list*, not the scroll container, and only positions within the list can be expressed
 * (it bottoms out at zero, so a position among content the caller renders above the list — e.g. a
 * header section — is left to the container restore below). It also can't be taken from virtuoso's
 * own `getState` as-is: with `customScrollParent`, the `scrollTop` that `getState` reports never
 * tracks the parent's scrolling (it stays 0), so only its size ranges are used and the offset is
 * derived from the container's scroll position and the list's position within the container.
 *
 * The saved *container* `scrollTop` is the source of truth for the final position, and the hook
 * applies it directly whenever the entry's state should be restored (or scrolls to the top when it
 * shouldn't). When the virtualized content's height isn't in the DOM yet — it lands only after
 * virtuoso's own effects process the (possibly seeded) sizes — the write clamps, so it's retried
 * for a few animation frames until the position sticks. Both the attempts and virtuoso's size
 * processing happen pre-paint, so a successful restore never flashes an intermediate position.
 *
 * As with `useScrollMemory`, the saved state comes from a scroll listener rather than a
 * cleanup-time read: a same-component pathname change can commit new content before the cleanup
 * for the old visit runs, so the container's live `scrollTop` (and virtuoso's live state) may
 * already reflect the swap by then. Scroll events dispatch asynchronously, so the listener's most
 * recent value always predates that swap.
 */
export function useVirtuosoScrollMemory(
  containerElem: HTMLElement | null,
  virtuosoRef: RefObject<VirtuosoStateHandle | null>,
): StateSnapshot | undefined {
  const entryKey = useHistoryEntryKey()

  // NOTE: read in the lazy initializer (once per mount) because the snapshot has to be available
  // on the render that first mounts the virtuoso component for `restoreStateFrom` to take effect.
  // The entry key it was read for is kept alongside it: the virtuoso component can unmount and
  // remount while this hook stays mounted (e.g. its data emptying during a refetch and then
  // filling back in), and a remounted instance applies `restoreStateFrom` anew — which must not
  // happen once the user has navigated to a different history entry.
  const [mountState] = useState(() => ({
    entryKey,
    saved: entryKey !== undefined ? scrollStates.get(entryKey) : undefined,
  }))

  useLayoutEffect(() => {
    if (!containerElem || entryKey === undefined) {
      return undefined
    }

    const saved = scrollStates.get(entryKey)
    const target = saved?.scrollTop ?? 0
    containerElem.scrollTo(0, target)

    // A target below the container's current content height can't be reached yet: the virtualized
    // list's full height only hits the DOM once virtuoso processes its (possibly restored) size
    // state in its own effects, which run before this one's next paint but after this call. Retry
    // for a few frames until the position sticks; each attempt runs pre-paint, so a successful
    // restore is never visible as a jump.
    let rafId = 0
    let attemptsLeft = 10
    if (target > 0 && containerElem.scrollTop !== target) {
      const retry = () => {
        rafId = 0
        containerElem.scrollTo(0, target)
        if (containerElem.scrollTop !== target && --attemptsLeft > 0) {
          rafId = requestAnimationFrame(retry)
        }
      }
      rafId = requestAnimationFrame(retry)
    }

    let lastScrollTop = target
    let lastSnapshot = saved?.snapshot
    const onScroll = () => {
      lastScrollTop = containerElem.scrollTop
      virtuosoRef.current?.getState(state => {
        // Only the size ranges are usable from getState (see the note on snapshots above); the
        // list-relative offset is derived from where virtuoso's scroller element sits within the
        // container's content.
        const scroller = containerElem.querySelector('[data-virtuoso-scroller]')
        if (scroller) {
          const listOffsetTop =
            scroller.getBoundingClientRect().top -
            containerElem.getBoundingClientRect().top +
            containerElem.scrollTop
          lastSnapshot = {
            ranges: state.ranges,
            scrollTop: Math.max(0, lastScrollTop - listOffsetTop),
          }
        }
      })
    }
    containerElem.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      containerElem.removeEventListener('scroll', onScroll)
      scrollStates.set(entryKey, { scrollTop: lastScrollTop, snapshot: lastSnapshot })
    }
  }, [containerElem, entryKey, virtuosoRef])

  return entryKey === mountState.entryKey ? mountState.saved?.snapshot : undefined
}
