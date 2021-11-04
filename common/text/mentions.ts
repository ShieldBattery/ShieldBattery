import { USERNAME_ALLOWED_CHARACTERS } from '../constants'
import { TypedGroupRegExpMatchArray } from '../regex'

/**
 * Regex for detecting and parsing user mentions. User mentions are a piece of text that start with
 * the @ sign, followed up by the username. Some punctuation is allowed after the username. Notably
 * missing from the allowed punctuation list are . and ! since they are allowed username characters
 * as well.
 *
 * The matched user's name is available in the "user" capture group. There's also two additional
 * capture groups, namely "prefix" and "postfix", that contain all the matched characters
 * before/after the username.
 */
export const MENTION_REGEX = new RegExp(
  String.raw`(?<prefix>\s|^)@(?<username>${USERNAME_ALLOWED_CHARACTERS})(?<postfix>\s|$|[,;:?])`,
  'gi',
)

/**
 * Regex for detecting an already parsed user mention. When a user mention is parsed, it is saved
 * with a custom markup syntax in the database. This regex parses the markup and extracts user IDs
 * to a "userId" capture group.
 *
 * Also, the whole regex is encapsulated in a "mention" capture group, so it can be grouped with
 * other markup regexes.
 */
export const MENTION_MARKUP_REGEX = /(?<mention><@(?<userId>\d+)>)/gi

/**
 * Matches all user mentions in a given text. The user is considered mentioned if the text contains
 * their name, preceded by the @ sign. Note that this function only matches things that fit the
 * mentions pattern, it doesn't also verify that the mentioned users actually exist in the system.
 *
 * @returns A generator of matches for mentions, where each match includes a named capture group
 *   called "username" which contains just the matched username of the user.
 */
export function* matchUserMentions(text: string): Generator<{
  type: 'mention'
  text: string
  index: number
  groups: Record<'prefix' | 'username' | 'postfix', string>
}> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<'prefix' | 'username' | 'postfix'>> =
    text.matchAll(MENTION_REGEX) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'mention',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}

/**
 * Matches all mention markups in a given text. The mention markup contains the user ID, which can
 * then be used to get the full user's info.
 *
 * @returns A generator of matches for mention markups, where each match includes a named capture
 *   group called "userId" which contains just the matched user ID of the user.
 */
export function* matchMentionsMarkup(text: string): Generator<{
  type: 'mentionMarkup'
  text: string
  index: number
  groups: Record<'mention' | 'userId', string>
}> {
  const matches: IterableIterator<TypedGroupRegExpMatchArray<'mention' | 'userId'>> = text.matchAll(
    MENTION_MARKUP_REGEX,
  ) as IterableIterator<any>

  for (const match of matches) {
    yield {
      type: 'mentionMarkup',
      text: match[0],
      index: match.index!,
      groups: match.groups,
    }
  }
}