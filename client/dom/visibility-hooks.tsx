import { useEffect, useState } from 'react'

/**
 * Tracks whether an element matching `targetSelector` inside `scrollParent` is currently within the
 * scroll viewport.
 *
 * Unlike attaching an `IntersectionObserver` to a ref'd element directly, this looks the target up by
 * selector, which makes it safe for targets that mount and unmount over time — e.g. a row in a
 * virtualized list (where a ref callback's changing identity would otherwise thrash the observer). A
 * `MutationObserver` re-attaches the `IntersectionObserver` whenever the target appears, reports
 * `false` when it's absent, and the `IntersectionObserver` reports the target's visibility — both on
 * first render and as it scrolls in and out.
 *
 * Returns `false` until a matching target has been found and measured.
 *
 * @param scrollParent the scrolling container to measure visibility against (and to search within)
 * @param targetSelector a CSS selector for the element of interest, relative to `scrollParent`
 */
export function useTargetVisibleInScrollParent(
  scrollParent: HTMLElement | null,
  targetSelector: string,
): boolean {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!scrollParent) {
      return undefined
    }

    let intersectionObserver: IntersectionObserver | null = null
    let observedTarget: Element | null = null

    const syncObservedTarget = () => {
      const target = scrollParent.querySelector(targetSelector)
      if (target === observedTarget) {
        return
      }
      intersectionObserver?.disconnect()
      observedTarget = target
      if (!target) {
        setIsVisible(false)
        return
      }
      intersectionObserver = new IntersectionObserver(
        entries => {
          setIsVisible(entries[entries.length - 1].isIntersecting)
        },
        { root: scrollParent },
      )
      intersectionObserver.observe(target)
    }

    // The target may mount/unmount as the list virtualizes, so re-sync on DOM changes (this also
    // catches the initial render, where the target may not exist yet when this effect first runs).
    const mutationObserver = new MutationObserver(syncObservedTarget)
    mutationObserver.observe(scrollParent, { childList: true, subtree: true })
    const rafId = requestAnimationFrame(syncObservedTarget)

    return () => {
      cancelAnimationFrame(rafId)
      mutationObserver.disconnect()
      intersectionObserver?.disconnect()
    }
  }, [scrollParent, targetSelector])

  return isVisible
}
