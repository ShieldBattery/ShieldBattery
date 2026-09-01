/**
 * Lazily-loaded emoji name data for `:shortcode:` autocomplete, sourced from the same dataset the
 * emoji picker uses so the two always agree. The data is a sizable chunk, so it only loads the
 * first time something asks for it.
 */

export interface UnicodeEmojiEntry {
  /** The rendered emoji (may be a multi-codepoint sequence). */
  emoji: string
  /** The primary human-readable name, e.g. "grinning face". */
  name: string
  /** All the names/keywords this emoji is searchable by, lowercase. */
  names: string[]
}

interface EmojiDataFile {
  emojis: Record<string, Array<{ n: string[]; u: string }>>
}

let cache: UnicodeEmojiEntry[] | undefined
let pendingLoad: Promise<UnicodeEmojiEntry[]> | undefined

export function getUnicodeEmojiEntries(): Promise<UnicodeEmojiEntry[]> {
  if (cache) {
    return Promise.resolve(cache)
  }
  // NOTE: This reaches into the library's dist internals because it has no public data export;
  // a version bump could move this file and break autocomplete while the picker keeps working.
  // The emote-suggestions tests load this for real, so a break gets caught there.
  pendingLoad ??= import('emoji-picker-react/dist/data/emojis.json').then(
    module => {
      const data = (module.default ?? module) as unknown as EmojiDataFile
      cache = Object.values(data.emojis)
        .flat()
        .map(({ n, u }) => ({
          emoji: String.fromCodePoint(...u.split('-').map(hex => parseInt(hex, 16))),
          // The names are a mix of keywords and the full name in no reliable order; the longest
          // one is consistently the most descriptive
          name: n.reduce((a, b) => (b.length > a.length ? b : a)),
          names: n,
        }))
      return cache
    },
    err => {
      // Clear the failed attempt so the next keystroke retries the load, instead of caching the
      // rejection for the rest of the session
      pendingLoad = undefined
      throw err
    },
  )
  return pendingLoad
}
