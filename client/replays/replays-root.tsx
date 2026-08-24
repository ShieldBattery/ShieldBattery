import { lazy, useLayoutEffect } from 'react'
import { useLocation } from 'wouter'
import { useTrackPageView } from '../analytics/analytics'
import { OnlyInAppPage } from '../download/only-in-app'
import { replace } from '../navigation/routing'
import { encodeViewPathname, parseViewPathname } from './replay-library-helpers'

const LoadableReplayLibrary = lazy(async () => ({
  default: (await import('./replay-library')).ReplayLibrary,
}))

export function ReplaysRoot() {
  const [pathname] = useLocation()
  const view = parseViewPathname(pathname)
  const canonicalPathname = encodeViewPathname(view)

  useTrackPageView(canonicalPathname)

  useLayoutEffect(() => {
    // Malformed subpaths parse as a coarser view than they spell, so the URL is corrected in place
    // to the canonical pathname of what's actually rendered. A bare trailing slash is tolerated
    // as-is: the strip-compare makes `/replays/` equal to its canonical form, so e.g. the app-bar
    // link's trailing-slash URL isn't churned.
    if (pathname.replace(/\/+$/, '') !== canonicalPathname) {
      replace(canonicalPathname + window.location.search)
    }
  }, [pathname, canonicalPathname])

  return IS_ELECTRON ? (
    // Each view is its own place: a view change pushes a different pathname, which mints a new
    // history entry and visit key (see `history-entry-key.ts`), and this key remounts the library
    // with it, so all of its once-per-mount per-visit state (restored entry window, scroll
    // snapshot, focused row) saves for the outgoing visit in unmount cleanups and starts fresh for
    // the new one. Filter/sort changes replace the URL under the same pathname and visit, so they
    // keep the instance.
    <LoadableReplayLibrary key={canonicalPathname} view={view} />
  ) : (
    <OnlyInAppPage />
  )
}
