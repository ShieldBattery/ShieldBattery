import { useEffect } from 'react'

/**
 * Tracks a page view for the given path whenever this hook is rendered, and whenever the provided
 * path changes.
 *
 * Note that the path doesn't need to correspond to a real path on the site, it can be any
 * descriptive string that is URL-safe, but it should be unique for each thing we want to track.
 */
export function useTrackPageView(path: string) {
  useEffect(() => {
    const url = new URL(path, window.location.origin).toString()
    window.fathom?.trackPageview({ url })
  }, [path])
}
