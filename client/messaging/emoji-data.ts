/**
 * Lazily-loaded emoji name data for `:shortcode:` autocomplete, sourced from the same dataset the
 * emoji picker uses so the two always agree. The data is a sizable chunk, so it only loads the
 * first time something asks for it.
 */

import type { EmojiData } from 'emoji-picker-react/dist/types/exposedTypes'
import { getAllShortcodes, getShortcode, loadShortcodes } from './emoji-shortcodes'

export interface UnicodeEmojiEntry {
  /** The rendered emoji (may be a multi-codepoint sequence). */
  emoji: string
  /** The primary human-readable name, e.g. "grinning face". */
  name: string
  /**
   * All the names/keywords this emoji is searchable by, lowercase. Includes every known
   * shortcode (with underscores replaced by spaces) alongside the dataset's own keywords.
   */
  names: string[]
  /** The Discord/Slack-style shortcode, e.g. "sweat_smile", if the shortcode dataset has one. */
  shortcode?: string
}

interface EmojiDataFile {
  emojis: Record<string, Array<{ n: string[]; u: string }>>
}

let cache: UnicodeEmojiEntry[] | undefined
let pendingLoad: Promise<UnicodeEmojiEntry[]> | undefined

// NOTE: This (and getPickerEmojiData below) reach into the library's dist internals because it
// has no public data export or shortcode support of its own; a version bump could move the data
// file and break autocomplete/search while the picker keeps working. The emote-suggestions tests
// load both for real, so a break gets caught there.

export function getUnicodeEmojiEntries(): Promise<UnicodeEmojiEntry[]> {
  if (cache) {
    return Promise.resolve(cache)
  }
  pendingLoad ??= Promise.all([
    import('emoji-picker-react/dist/data/emojis.json'),
    loadShortcodes(),
  ]).then(
    ([module]) => {
      const data = (module.default ?? module) as unknown as EmojiDataFile
      cache = Object.values(data.emojis)
        .flat()
        .map(({ n, u }) => {
          // Some emoji have several shortcodes (e.g. 👍 is both "+1" and "thumbsup"); every one
          // needs to be searchable, not just the primary one used for display
          const extraForms = getAllShortcodes(u)
            .map(code => code.replaceAll('_', ' '))
            .filter(form => !n.includes(form))
          return {
            emoji: String.fromCodePoint(...u.split('-').map(hex => parseInt(hex, 16))),
            // The names are a mix of keywords and the full name in no reliable order; the longest
            // one is consistently the most descriptive
            name: n.reduce((a, b) => (b.length > a.length ? b : a)),
            names: extraForms.length ? [...n, ...extraForms] : n,
            shortcode: getShortcode(u),
          }
        })
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

let pickerDataCache: EmojiData | undefined
let pendingPickerDataLoad: Promise<EmojiData> | undefined

/**
 * Lazily-loaded emoji dataset for the picker's `emojiData` prop, augmented with every known
 * Discord/Slack-style shortcode so the picker's own search (a substring match over each emoji's
 * keyword list) finds shortcodes too, not just the dataset's generic keywords. Cached (like
 * `getUnicodeEmojiEntries` above) so repeat opens of the picker get the same object identity
 * instead of rebuilding it, and so callers can share it freely: the picker deep-clones whatever
 * it's given, so handing out the same reference to every caller is safe.
 */
export function getPickerEmojiData(): Promise<EmojiData> {
  if (pickerDataCache) {
    return Promise.resolve(pickerDataCache)
  }
  pendingPickerDataLoad ??= Promise.all([
    import('emoji-picker-react/dist/data/emojis.json'),
    loadShortcodes(),
  ]).then(
    ([module]) => {
      const data = (module.default ?? module) as unknown as EmojiData
      const emojis: EmojiData['emojis'] = {}
      for (const [category, list] of Object.entries(data.emojis)) {
        emojis[category] = list.map(e => {
          const shortcodes = getAllShortcodes(e.u)
          if (!shortcodes.length) {
            // Nothing to add: pass the entry through by reference rather than cloning it
            return e
          }
          const extraForms: string[] = []
          for (const code of shortcodes) {
            if (!e.n.includes(code)) {
              extraForms.push(code)
            }
            const spaced = code.replaceAll('_', ' ')
            if (spaced !== code && !e.n.includes(spaced)) {
              extraForms.push(spaced)
            }
          }
          if (!extraForms.length) {
            return e
          }
          // The library displays the LAST element of `n` as the emoji's name/aria-label, so the
          // extra searchable forms have to be prepended rather than appended
          return { ...e, n: [...extraForms, ...e.n] }
        })
      }
      // The dataset's `categories` carry lowercase label overrides (e.g. "people & body") that
      // would replace the library's nicely-cased default header labels, so they're deliberately
      // omitted — an empty map keeps the defaults
      pickerDataCache = { categories: {}, emojis }
      return pickerDataCache
    },
    err => {
      // Clear the failed attempt so the next open retries the load, instead of caching the
      // rejection for the rest of the session
      pendingPickerDataLoad = undefined
      throw err
    },
  )
  return pendingPickerDataLoad
}
