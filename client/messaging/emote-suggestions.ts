import { CUSTOM_EMOTES } from '../../common/text/custom-emotes'
import { customEmoteImageUrl } from './custom-emotes'
import { UnicodeEmojiEntry } from './emoji-data'

/** As with mentions, cap the emote suggestions to a number that doesn't need scrolling. */
export const MAX_EMOTE_SUGGESTIONS = 10

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
   * Match quality (0 = a name matches the query exactly, 1 = prefix match, 2 = substring match).
   * Suggestions are sorted by this when custom and built-in results merge, so e.g. `:fire`
   * suggests 🔥 (exact) ahead of Firebat (prefix).
   */
  rank: number
  /** The emoji character to display as the icon, for built-in emojis. */
  emoji?: string
  /** The image to display as the icon, for custom emotes. */
  imgUrl?: string
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
 * Records that an emote/emoji was inserted, so suggestions can be ordered by frequency of use.
 * Keys are the suggestion keys (custom emote codes or `u:<emoji>`), matched case-insensitively
 * since custom emote codes are.
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

/** Returns 0 for an exact match, 1 for prefix, 2 for substring, or -1 for no match at all. */
export function matchRank(names: ReadonlyArray<string>, query: string): number {
  if (names.some(n => n === query)) {
    return 0
  }
  if (names.some(n => n.startsWith(query))) {
    return 1
  }
  if (names.some(n => n.includes(query))) {
    return 2
  }
  return -1
}

export function searchCustomEmotes(query: string): EmoteSuggestion[] {
  const q = query.toLowerCase()
  return CUSTOM_EMOTES.flatMap(e => {
    const rank = matchRank([e.code.toLowerCase(), e.name.toLowerCase()], q)
    const imgUrl = customEmoteImageUrl(e.code)
    return rank >= 0 && imgUrl
      ? [{ key: e.code, insertText: `:${e.code}: `, name: e.name, rank, imgUrl }]
      : []
  })
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
  for (const entry of entries) {
    if (entry.names.some(n => n === q)) {
      exactMatches.push(entry)
    } else if (entry.names.some(n => n.startsWith(q))) {
      prefixMatches.push(entry)
    } else if (entry.names.some(n => n.includes(q))) {
      otherMatches.push(entry)
    }
  }
  // Multiple emojis can share an exact keyword (e.g. "fire" is a keyword of 🔥, 🚒 and 🧑‍🚒);
  // the one with the fewest keywords tends to be the canonical bearer of the name, and simpler
  // sequences beat multi-codepoint ones
  exactMatches.sort((a, b) => a.names.length - b.names.length || a.emoji.length - b.emoji.length)
  const toSuggestion = (e: UnicodeEmojiEntry, rank: number): EmoteSuggestion => ({
    key: `u:${e.emoji}`,
    insertText: e.emoji,
    name: e.name,
    rank,
    emoji: e.emoji,
    imgUrl: e.imgUrl,
  })
  return exactMatches
    .map(e => toSuggestion(e, 0))
    .concat(
      prefixMatches.map(e => toSuggestion(e, 1)),
      otherMatches.map(e => toSuggestion(e, 2)),
    )
}

/**
 * Merges custom and built-in suggestions into the final capped list, ordered by match quality and
 * then by how often each has been inserted before. The sort is stable, so custom emotes come
 * before built-ins that tie on both.
 */
export function mergeEmoteSuggestions(
  custom: ReadonlyArray<EmoteSuggestion>,
  unicode: ReadonlyArray<EmoteSuggestion>,
  getUsage: (key: string) => number = getEmoteUsage,
): EmoteSuggestion[] {
  return custom
    .concat(unicode)
    .sort((a, b) => a.rank - b.rank || getUsage(b.key) - getUsage(a.key))
    .slice(0, MAX_EMOTE_SUGGESTIONS)
}
