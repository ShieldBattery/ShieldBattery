import type { MouseEvent } from 'react'
import { assertUnreachable } from '../../common/assert-unreachable'
import { urlPath } from '../../common/urls'
import { useUserLocalStorageValue } from '../react/state-hooks'

/**
 * The replay library's views and the URLs that address them, plus the per-user memory of which
 * view (and folder) was last open. Kept free of the library's UI dependencies so the app bar can
 * link into the library without loading it.
 */

/** Which subset of the library the rail is currently pointed at, addressed by the `/replays…` pathname. */
export type LibraryView =
  | { kind: 'all' }
  | { kind: 'bookmarked' }
  | { kind: 'playlist'; id: number }
  | { kind: 'folders' }

/**
 * Parses a pathname under `/replays` into the `LibraryView` it addresses:
 * - `/replays` (and `/replays/`) -> the whole library (`all`)
 * - `/replays/bookmarked` -> `bookmarked`
 * - `/replays/folders` -> `folders` (the folder being browsed rides in the `folder` search param)
 * - `/replays/playlists/<id>` -> `playlist` with that id
 *
 * Trailing slashes are tolerated. Anything else — an unparseable playlist id, an unrecognized
 * subpath, extra segments — falls back to `all`; callers that need the URL itself to reflect that
 * fallback canonicalize it separately (see `encodeViewPathname`).
 */
export function parseViewPathname(pathname: string): LibraryView {
  const segments = pathname.split('/').filter(segment => segment.length > 0)

  if (segments.length === 2 && segments[1] === 'bookmarked') {
    return { kind: 'bookmarked' }
  }
  if (segments.length === 2 && segments[1] === 'folders') {
    return { kind: 'folders' }
  }
  if (segments.length === 3 && segments[1] === 'playlists') {
    const id = Number.parseInt(segments[2], 10)
    if (Number.isFinite(id)) {
      return { kind: 'playlist', id }
    }
  }
  return { kind: 'all' }
}

/**
 * Encodes a `LibraryView` into its canonical `/replays…` pathname (the form `parseViewPathname`
 * parses back to the same view).
 */
export function encodeViewPathname(view: LibraryView): string {
  switch (view.kind) {
    case 'all':
      return '/replays'
    case 'bookmarked':
      return '/replays/bookmarked'
    case 'playlist':
      return urlPath`/replays/playlists/${view.id}`
    case 'folders':
      return '/replays/folders'
    default:
      return assertUnreachable(view)
  }
}

/** The search param holding the folder the folders view is browsing (absent at the top level). */
export const FOLDER_SEARCH_PARAM = 'folder'

/**
 * The search string to carry from `search` into `target` when switching views: the filters ride
 * along, but the browsed folder belongs to the folders view alone. Entering the folders view
 * reopens `rememberedFolder`, the folder last browsed there, when there is one.
 */
export function searchForViewChange(
  search: string,
  target: LibraryView,
  rememberedFolder: string | undefined,
): string {
  const params = new URLSearchParams(search)
  params.delete(FOLDER_SEARCH_PARAM)
  if (target.kind === 'folders' && rememberedFolder) {
    params.set(FOLDER_SEARCH_PARAM, rememberedFolder)
  }
  const searchString = params.toString()
  return searchString ? `?${searchString}` : ''
}

/** A stored folder is only usable as a non-empty string; anything else counts as none. */
function validateRememberedFolder(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

/**
 * A stored view is the canonical pathname of a view; anything else (garbage from an older build, a
 * hand edit) reads as the whole library.
 */
function validateRememberedView(value: unknown): string | undefined {
  return typeof value === 'string' ? encodeViewPathname(parseViewPathname(value)) : undefined
}

/**
 * The folder last browsed in the folders view (`''` when none, or the top level), remembered per
 * user. Storing `undefined` forgets it.
 */
export function useRememberedLibraryFolder() {
  return useUserLocalStorageValue('replays.library.folder', '', validateRememberedFolder)
}

/**
 * The canonical pathname of the library view last shown, remembered per user. Storing `undefined`
 * forgets it (which reads as the whole library).
 */
export function useRememberedLibraryView() {
  return useUserLocalStorageValue(
    'replays.library.view',
    encodeViewPathname({ kind: 'all' }),
    validateRememberedView,
  )
}

/**
 * The URL that reopens the library where the user left it: the remembered view, and for the
 * folders view the remembered folder too. Values are taken as stored, so anything unusable falls
 * back to the whole library (or the folders view's top level).
 */
export function replaysHrefFromRemembered(storedView: unknown, storedFolder: unknown): string {
  const view = parseViewPathname(validateRememberedView(storedView) ?? '')
  return (
    encodeViewPathname(view) + searchForViewChange('', view, validateRememberedFolder(storedFolder))
  )
}

/**
 * Whether `pathname` already shows the library view `href` addresses. Since the library remembers
 * whichever view it shows, a link to the remembered view points at the current view whenever the
 * library is open.
 */
export function isShowingLibraryHref(pathname: string, href: string): boolean {
  const hrefPathname = new URL(href, 'http://localhost').pathname
  return pathname.replace(/\/+$/, '') === hrefPathname
}

/**
 * An app-level link into the replay library (e.g. the app bar's Replays entry), which reopens the
 * view and folder the user was last on. Following it while that view is already showing does
 * nothing (`onClick` cancels the navigation), rather than stacking a duplicate history entry or
 * dropping the view's current filters from the URL.
 */
export function useReplaysLink(): {
  href: string
  onClick: (event: MouseEvent) => void
} {
  const [rememberedView] = useRememberedLibraryView()
  const [rememberedFolder] = useRememberedLibraryFolder()
  const href = replaysHrefFromRemembered(rememberedView, rememberedFolder)
  const onClick = (event: MouseEvent) => {
    if (isShowingLibraryHref(window.location.pathname, href)) {
      event.preventDefault()
    }
  }
  return { href, onClick }
}
