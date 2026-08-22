/**
 * Stamps every history entry with a per-entry "visit key" that mirrors the granularity browsers
 * use for their own native scroll restoration: one key per entry in the back/forward stack, not
 * one per pathname or logical page. A store keyed by this identifier restores on back/forward
 * traversal to an entry (or to another entry that shares its visit) but starts fresh when a link
 * push lands on a pathname that's already been visited under a different entry.
 *
 * Two kinds of transitions deliberately keep the current visit key instead of minting a new one:
 *  - A push whose target pathname is unchanged from the current one (only the search string or
 *    hash differs, or an overlay is pushed on top of the same URL) — this covers things like
 *    filters/pagination expressed as search params, and full-screen overlays that sit on top of
 *    the page underneath them.
 *  - Any replace, regardless of pathname — this covers in-place URL corrections (e.g. a username
 *    whose canonical casing gets patched into the URL) that should read as a continuation of the
 *    same visit rather than a new one.
 *
 * Some parts of the app put an explicit sentinel value into `history.state` to track UI state
 * (for example, marking a settings overlay as open) and later compare that value by identity. Stamping over such a value would break those comparisons, so a push or
 * replace that's given a non-null state passes through completely untouched: no stamp is added,
 * and the current visit key is left as-is. `getHistoryEntryKey` returns `undefined` for an entry
 * like that; anything keyed off the visit simply has nothing to restore while it's current.
 */

const ENTRY_KEY_PROP = '__sbEntryKey'

interface StampedState {
  [ENTRY_KEY_PROP]: string
}

function isStampedState(state: unknown): state is StampedState {
  return (
    typeof state === 'object' &&
    state !== null &&
    typeof (state as Record<string, unknown>)[ENTRY_KEY_PROP] === 'string'
  )
}

/**
 * Returns the visit key stamped onto `state` (the current `history.state` by default), or
 * `undefined` if it holds no stamp — either because it's an app-provided sentinel value, or
 * because it's `null`/`undefined`.
 */
export function getHistoryEntryKey(state: unknown = history.state): string | undefined {
  return isStampedState(state) ? state[ENTRY_KEY_PROP] : undefined
}

let currentVisitKey: string | undefined

let installed = false
let originalPushState: History['pushState'] | undefined
let originalReplaceState: History['replaceState'] | undefined
let onPopState: (() => void) | undefined

/**
 * Patches `history.pushState`/`replaceState` to stamp a visit key onto every entry that isn't
 * carrying an app-provided state value, and tracks the current entry's key across navigation.
 *
 * This wraps whatever `pushState`/`replaceState` currently are, native or already patched by
 * something else (e.g. a router that dispatches its own events around them), and always calls
 * through to that implementation so its behavior is preserved; this module only decides what
 * state object goes out and records the key of the entry that results.
 */
export function installHistoryEntryKeys(): void {
  if (installed) {
    return
  }
  installed = true

  originalPushState = history.pushState.bind(history)
  originalReplaceState = history.replaceState.bind(history)
  const pushState = originalPushState
  const replaceState = originalReplaceState

  history.pushState = (state: unknown, unused: string, url?: string | URL | null): void => {
    if (state != null) {
      pushState(state, unused, url)
      return
    }

    const fromPathname = window.location.pathname
    const toPathname =
      url == null || url === '' ? fromPathname : new URL(String(url), window.location.href).pathname

    const key =
      toPathname === fromPathname ? (currentVisitKey ?? crypto.randomUUID()) : crypto.randomUUID()

    pushState({ [ENTRY_KEY_PROP]: key }, unused, url)
    currentVisitKey = key
  }

  history.replaceState = (state: unknown, unused: string, url?: string | URL | null): void => {
    if (state != null) {
      replaceState(state, unused, url)
      return
    }

    const key = getHistoryEntryKey() ?? currentVisitKey ?? crypto.randomUUID()

    replaceState({ [ENTRY_KEY_PROP]: key }, unused, url)
    currentVisitKey = key
  }

  onPopState = () => {
    // Traversing onto an unkeyed sentinel entry (an overlay opened over some page) keeps the
    // surrounding visit's key, since the page under the overlay hasn't changed.
    currentVisitKey = getHistoryEntryKey() ?? currentVisitKey
  }
  window.addEventListener('popstate', onPopState)

  if (history.state == null) {
    history.replaceState(null, '')
  }
  currentVisitKey = getHistoryEntryKey()
}

/** Undoes {@link installHistoryEntryKeys} and clears its tracked state. Only for use in tests. */
export function resetHistoryEntryKeysForTesting(): void {
  if (!installed) {
    return
  }

  if (originalPushState) {
    history.pushState = originalPushState
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState
  }
  if (onPopState) {
    window.removeEventListener('popstate', onPopState)
  }

  installed = false
  originalPushState = undefined
  originalReplaceState = undefined
  onPopState = undefined
  currentVisitKey = undefined
}
