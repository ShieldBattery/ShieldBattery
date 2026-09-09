/**
 * Regex for detecting unicode emoji in message text. `\p{RGI_Emoji}` is a "property of strings"
 * (available with the `v` flag) that matches only sequences the Unicode Recommended for General
 * Interchange set actually defines as emoji — including multi-codepoint ZWJ sequences (e.g. the
 * family emoji) and keycap sequences (e.g. `1️⃣`) — so incidental codepoints like a lone `#` or
 * digit don't match. Adjacent emoji are grouped into a single run so consecutive emoji in a
 * message coalesce into one match.
 */
const UNICODE_EMOJI_REGEX = /(?:\p{RGI_Emoji})+/gv

/**
 * Matches a single (ungrouped) emoji sequence. Used both to split a run of adjacent emoji (as
 * produced by `matchUnicodeEmojis`) back into its individual sequences and to count emoji in a
 * string.
 */
const SINGLE_UNICODE_EMOJI_REGEX = /\p{RGI_Emoji}/gv

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
  return Array.from(text.matchAll(SINGLE_UNICODE_EMOJI_REGEX)).length
}

/**
 * Splits a run of adjacent emoji (as produced by `matchUnicodeEmojis`) into its individual RGI
 * emoji sequences, in order.
 */
export function splitEmojiRun(run: string): string[] {
  return Array.from(run.matchAll(SINGLE_UNICODE_EMOJI_REGEX), match => match[0])
}
