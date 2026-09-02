/**
 * Lazily-loaded Discord/Slack-style emoji shortcodes (`:sweat_smile:`), sourced from emojibase's
 * "iamcal" shortcode preset. This is a separate dataset from the one `emoji-data.ts` builds
 * entries from, so unified hexcodes need to be reconciled between the two: the picker dataset's
 * `u` values sometimes carry the FE0F variation selector (e.g. "263a-fe0f") while this dataset's
 * keys never do, so a lookup should retry with FE0F segments stripped before giving up.
 */

/** Maps UPPERCASE dash-separated hexcode to a shortcode, or an array when more than one applies. */
type ShortcodesDataFile = Record<string, string | string[]>

let cache: Map<string, string[]> | undefined
let pendingLoad: Promise<Map<string, string[]>> | undefined

function stripFe0f(unified: string): string {
  return unified
    .split('-')
    .filter(segment => segment !== 'fe0f')
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
  return cache.get(lower) ?? cache.get(stripFe0f(lower)) ?? []
}
