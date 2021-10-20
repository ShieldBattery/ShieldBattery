const MENTION_PREFIX = String.raw`(?:\s|^)@(?<user>`
const MENTION_SUFIX = String.raw`)(?:\s|$|[,;:?])`

/**
 * Tests whether the given user is mentioned in a given text. The user is considered mentioned if
 * the text contains their name, preceded by the @ sign. The test is done case-insensitively.
 */
export function isUserMentioned(user: string, text: string): boolean {
  return new RegExp(`${MENTION_PREFIX}${user}${MENTION_SUFIX}`, 'i').test(text)
}
