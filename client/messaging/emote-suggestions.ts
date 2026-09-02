import UFuzzy from '@leeoniya/ufuzzy'
import { UnicodeEmojiEntry } from './emoji-data'

/** As with mentions, cap the emote suggestions to a number that doesn't need scrolling. */
export const MAX_EMOTE_SUGGESTIONS = 10

// Same options as the @-mention matcher: chars in order, anything between, case-insensitive. A
// UFuzzy instance holds no per-search state, so one instance serves every call.
const fuzzy = new UFuzzy({ intraIns: Infinity, intraChars: '.' })

/**
 * Regex matching a partially-typed `:emoteQuery` immediately before the caret. Requires at least
 * two characters after the colon (so ordinary punctuation doesn't trigger it) and whitespace (or
 * the message start) before it (so times like "10:30" don't).
 */
export const EMOTE_QUERY_REGEX = /(?<=^|\s):(?<query>[\w+-]{2,})$/

export interface EmoteSuggestion {
  /** A unique key for rendering. */
  key: string
  /** The text that replaces the typed `:query` when this suggestion is picked. */
  insertText: string
  /** The suggestion's display name. */
  name: string
  /**
   * Match quality (0 = a name matches the query exactly, 1 = prefix match, 2 = substring match,
   * 3 = fuzzy match — the query's characters appear in a name in order, with anything allowed
   * between them, same as `@mention` matching). Suggestions are sorted by this, so e.g. `:fire`
   * suggests 🔥 (exact) ahead of prefix matches.
   */
  rank: number
  /** The emoji character to display as the icon. */
  emoji: string
}

const USAGE_STORAGE_KEY = 'sb.emoteUsage'

let usageCache: Record<string, number> | undefined

function loadUsage(): Record<string, number> {
  if (!usageCache) {
    try {
      usageCache = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) ?? '{}')
    } catch {
      usageCache = {}
    }
  }
  return usageCache!
}

/**
 * Records that an emoji was inserted, so suggestions can be ordered by frequency of use. Keys are
 * the suggestion keys (`u:<emoji>`), matched case-insensitively.
 */
export function recordEmoteUsage(key: string): void {
  const usage = loadUsage()
  const k = key.toLowerCase()
  usage[k] = (usage[k] ?? 0) + 1
  try {
    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify(usage))
  } catch {
    // Persisting usage is best-effort (e.g. storage may be full or unavailable)
  }
}

export function getEmoteUsage(key: string): number {
  return loadUsage()[key.toLowerCase()] ?? 0
}

// Flattened (name, owning entry index) rows for the fuzzy pass over the unicode dataset, rebuilt
// only when handed a different `entries` array. `getUnicodeEmojiEntries()` caches and returns the
// same array identity once loaded, so this stays a one-time cost rather than a per-keystroke one
// over the ~12k rows.
let flattenedNamesFor: ReadonlyArray<UnicodeEmojiEntry> | undefined
let flattenedNames: string[] = []
let flattenedNameEntryIndex: number[] = []

function getFlattenedNames(entries: ReadonlyArray<UnicodeEmojiEntry>) {
  if (flattenedNamesFor !== entries) {
    flattenedNamesFor = entries
    flattenedNames = []
    flattenedNameEntryIndex = []
    entries.forEach((entry, entryIndex) => {
      for (const name of entry.names) {
        flattenedNames.push(name)
        flattenedNameEntryIndex.push(entryIndex)
      }
    })
  }
  return { names: flattenedNames, nameEntryIndex: flattenedNameEntryIndex }
}

export function searchUnicodeEmojis(
  entries: ReadonlyArray<UnicodeEmojiEntry>,
  query: string,
): EmoteSuggestion[] {
  // Underscores map to spaces so that typing shortcode-style (:grinning_face:) works against the
  // dataset's space-separated names
  const q = query.toLowerCase().replaceAll('_', ' ')
  const exactMatches: UnicodeEmojiEntry[] = []
  const prefixMatches: UnicodeEmojiEntry[] = []
  const otherMatches: UnicodeEmojiEntry[] = []
  const tieredEntries = new Set<UnicodeEmojiEntry>()
  for (const entry of entries) {
    if (entry.names.some(n => n === q)) {
      exactMatches.push(entry)
      tieredEntries.add(entry)
    } else if (entry.names.some(n => n.startsWith(q))) {
      prefixMatches.push(entry)
      tieredEntries.add(entry)
    } else if (entry.names.some(n => n.includes(q))) {
      otherMatches.push(entry)
      tieredEntries.add(entry)
    }
  }
  // Multiple emojis can share an exact keyword (e.g. "fire" is a keyword of 🔥, 🚒 and 🧑‍🚒);
  // the one with the fewest keywords tends to be the canonical bearer of the name, and simpler
  // sequences beat multi-codepoint ones
  exactMatches.sort((a, b) => a.names.length - b.names.length || a.emoji.length - b.emoji.length)

  // Entries that missed every tier get one more shot via fuzzy matching. `names` is flattened so
  // a single fuzzy.filter call covers every entry's keywords at once; rows come back in haystack
  // order, which is entry order, so deduping by first occurrence keeps entries in ascending order.
  const { names, nameEntryIndex } = getFlattenedNames(entries)
  const fuzzyRows = fuzzy.filter(names, q) ?? []
  const fuzzyMatches: UnicodeEmojiEntry[] = []
  const seenFuzzyEntries = new Set<number>()
  for (const row of fuzzyRows) {
    const entryIndex = nameEntryIndex[row]
    if (seenFuzzyEntries.has(entryIndex) || tieredEntries.has(entries[entryIndex])) {
      continue
    }
    seenFuzzyEntries.add(entryIndex)
    fuzzyMatches.push(entries[entryIndex])
  }

  const toSuggestion = (e: UnicodeEmojiEntry, rank: number): EmoteSuggestion => ({
    key: `u:${e.emoji}`,
    insertText: e.emoji,
    // Prefer the Discord/Slack-style shortcode when one is known; otherwise fall back to a
    // shortcode-shaped rendering of the primary name (spaces to underscores)
    name: `:${e.shortcode ?? e.name.replaceAll(' ', '_')}:`,
    rank,
    emoji: e.emoji,
  })
  return exactMatches
    .map(e => toSuggestion(e, 0))
    .concat(
      prefixMatches.map(e => toSuggestion(e, 1)),
      otherMatches.map(e => toSuggestion(e, 2)),
      fuzzyMatches.map(e => toSuggestion(e, 3)),
    )
}

/**
 * Orders suggestions by match quality and then by how often each has been inserted before,
 * capped to the number the menu shows without scrolling.
 */
export function orderEmoteSuggestions(
  suggestions: ReadonlyArray<EmoteSuggestion>,
  getUsage: (key: string) => number = getEmoteUsage,
): EmoteSuggestion[] {
  return suggestions
    .slice()
    .sort((a, b) => a.rank - b.rank || getUsage(b.key) - getUsage(a.key))
    .slice(0, MAX_EMOTE_SUGGESTIONS)
}
