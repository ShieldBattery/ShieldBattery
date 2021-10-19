/**
 * Tests whether the given user is mentioned in a given text. The user is considered mentioned if
 * the text contains their name, preceded by the @ sign. The test is done case-insensitively.
 */
export function isUserMentioned(user: string, text: string): boolean {
  return new RegExp(`@${user}`, 'i').test(text)
}
