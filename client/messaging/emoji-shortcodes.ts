/**
 * Lazily-loaded Discord/Slack-style emoji shortcodes (`:sweat_smile:`), sourced from emojibase's
 * "iamcal" shortcode preset. This is a separate dataset from the one `emoji-data.ts` builds
 * entries from, so unified hexcodes need to be reconciled between the two: the picker dataset's
 * `u` values sometimes carry the FE0F variation selector (e.g. "263a-fe0f") while this dataset's
 * keys never do, so a lookup should retry with FE0F segments stripped before giving up. The
 * dataset also only keys the untoned base form of an emoji, so skin-tone modifier segments are
 * dropped as a further, last-resort retry.
 */

/** Maps UPPERCASE dash-separated hexcode to a shortcode, or an array when more than one applies. */
type ShortcodesDataFile = Record<string, string | string[]>

let cache: Map<string, string[]> | undefined
let pendingLoad: Promise<Map<string, string[]>> | undefined

/** Listeners notified once, when the shortcode dataset finishes loading. */
const loadListeners = new Set<() => void>()

function stripFe0f(unified: string): string {
  return unified
    .split('-')
    .filter(segment => segment !== 'fe0f')
    .join('-')
}

const SKIN_TONE_SEGMENTS = new Set(['1f3fb', '1f3fc', '1f3fd', '1f3fe', '1f3ff'])

function stripSkinTones(unified: string): string {
  return unified
    .split('-')
    .filter(segment => !SKIN_TONE_SEGMENTS.has(segment))
    .join('-')
}

/**
 * Loads (and caches) the shortcode dataset, keyed by lowercased unified hexcode to every known
 * shortcode for it (in dataset order; the first is the primary one). Safe to call repeatedly;
 * concurrent callers share the same in-flight load.
 */
export function loadShortcodes(): Promise<Map<string, string[]>> {
  if (cache) {
    return Promise.resolve(cache)
  }
  pendingLoad ??= import('emojibase-data/en/shortcodes/iamcal.json').then(
    module => {
      const data = (module.default ?? module) as unknown as ShortcodesDataFile
      const map = new Map<string, string[]>()
      for (const [hexcode, value] of Object.entries(data)) {
        map.set(hexcode.toLowerCase(), Array.isArray(value) ? value : [value])
      }
      cache = map
      for (const listener of loadListeners) {
        listener()
      }
      return map
    },
    err => {
      // Clear the failed attempt so the next caller retries the load, instead of caching the
      // rejection for the rest of the session
      pendingLoad = undefined
      throw err
    },
  )
  return pendingLoad
}

/**
 * Looks up the primary shortcode for a dash-separated unified hexcode (as found in the emoji
 * picker dataset's `u` field, e.g. "1f605" or "263a-fe0f"). Returns `undefined` both when there's
 * no match and when the dataset hasn't finished loading yet (call `loadShortcodes` first).
 */
export function getShortcode(unified: string): string | undefined {
  return getAllShortcodes(unified)[0]
}

/**
 * Like `getShortcode`, but returns every known shortcode (empty when there's no match or the
 * dataset hasn't loaded yet).
 */
export function getAllShortcodes(unified: string): string[] {
  if (!cache) {
    return []
  }
  const lower = unified.toLowerCase()
  const withoutFe0f = stripFe0f(lower)
  return cache.get(lower) ?? cache.get(withoutFe0f) ?? cache.get(stripSkinTones(withoutFe0f)) ?? []
}

/**
 * Converts an emoji string to its dash-separated hexcode and looks up its primary shortcode. Both
 * datasets zero-pad each codepoint segment to four hex digits (e.g. `0031-fe0f-20e3`, `00a9`), so
 * short codepoints are padded before lookup. Returns `undefined` both when there's no match and
 * when the dataset hasn't finished loading yet (call `loadShortcodes` first).
 */
export function getShortcodeForEmoji(emoji: string): string | undefined {
  const segments = Array.from(emoji, ch => ch.codePointAt(0)!.toString(16).padStart(4, '0'))
  return getShortcode(segments.join('-'))
}

/**
 * Whether the shortcode dataset has finished loading. Intended for `useSyncExternalStore`
 * alongside `subscribeToShortcodesLoaded`, so a component that shows shortcodes re-renders itself
 * once the dataset arrives instead of polling or re-rendering its parents.
 */
export function areShortcodesLoaded(): boolean {
  return cache !== undefined
}

/**
 * Subscribes a listener to be called once, when the shortcode dataset finishes loading. Returns an
 * unsubscribe function. Intended for `useSyncExternalStore` alongside `areShortcodesLoaded`, so a
 * component that shows shortcodes re-renders itself once the dataset arrives instead of polling or
 * re-rendering its parents.
 */
export function subscribeToShortcodesLoaded(listener: () => void): () => void {
  loadListeners.add(listener)
  return () => {
    loadListeners.delete(listener)
  }
}
