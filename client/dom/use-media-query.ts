import { useSyncExternalStore } from 'react'

/**
 * Tracks whether a CSS media query currently matches, re-rendering when that changes. The query is
 * evaluated through `window.matchMedia`, so it sees exactly what a stylesheet `@media` rule with the
 * same text would, which lets behavior (not just styling) key off one breakpoint.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = (onChange: () => void) => {
    const mediaQueryList = window.matchMedia(query)
    mediaQueryList.addEventListener('change', onChange)
    return () => mediaQueryList.removeEventListener('change', onChange)
  }
  const getSnapshot = () => window.matchMedia(query).matches

  return useSyncExternalStore(subscribe, getSnapshot)
}
