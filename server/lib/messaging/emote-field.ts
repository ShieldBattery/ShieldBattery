/**
 * Spreads the action-line flag into a text message's stored or published shape. The flag only ever
 * exists as `true`, so a message that isn't an action line carries no key for it at all.
 */
export function emoteField(emote?: boolean): { emote?: true } {
  return emote ? { emote: true } : {}
}
