/**
 * Regex for detecting unicode emoji in message text. `\p{RGI_Emoji}` is a "property of strings"
 * (available with the `v` flag) that matches only sequences the Unicode Recommended for General
 * Interchange set actually defines as emoji — including multi-codepoint ZWJ sequences (e.g. the
 * family emoji) and keycap sequences (e.g. `1️⃣`) — so incidental codepoints like a lone `#` or
 * digit don't match. Adjacent emoji are grouped into a single run so consecutive emoji in a
 * message coalesce into one match.
 */
const UNICODE_EMOJI_REGEX = /(?:\p{RGI_Emoji})+/gv

/** Matches individual emoji sequences (not grouped into runs), used to count emoji in a string. */
const UNICODE_EMOJI_COUNT_REGEX = /\p{RGI_Emoji}/gv

export interface UnicodeEmojiMatch {
  type: 'unicodeEmoji'
  text: string
  index: number
}

/** Matches all runs of consecutive unicode emoji in a given text. */
export function* matchUnicodeEmojis(text: string): Generator<UnicodeEmojiMatch> {
  const matches: IterableIterator<RegExpMatchArray> = text.matchAll(UNICODE_EMOJI_REGEX)

  for (const match of matches) {
    yield {
      type: 'unicodeEmoji',
      text: match[0],
      index: match.index!,
    }
  }
}

/** Counts the number of individual emoji sequences present in a string. */
export function countEmojisIn(text: string): number {
  return Array.from(text.matchAll(UNICODE_EMOJI_COUNT_REGEX)).length
}
