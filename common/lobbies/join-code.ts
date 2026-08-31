import { RANDOM_EMAIL_CODE_CHARACTERS } from '../users/user-network'

/** The number of characters in a lobby join code (before display formatting adds a dash). */
export const LOBBY_JOIN_CODE_LENGTH = 6

const JOIN_CODE_PATTERN = new RegExp(
  `^[${RANDOM_EMAIL_CODE_CHARACTERS}]{${LOBBY_JOIN_CODE_LENGTH}}$`,
)

/**
 * Normalizes join code input into the canonical form used for matching: uppercased, with all
 * whitespace and dashes removed. A join code may be typed or pasted in lower case, with or
 * without the displayed dash or surrounding spaces, so every entry point (client input, server
 * lookup) must run its input through this before comparing or validating it.
 */
export function normalizeJoinCode(input: string): string {
  return input.replace(/[\s-]/g, '').toUpperCase()
}

/**
 * Returns whether `normalized` is a well-formed join code: exactly
 * {@link LOBBY_JOIN_CODE_LENGTH} characters, all drawn from the join code alphabet
 * (`RANDOM_EMAIL_CODE_CHARACTERS`). Expects input that has already been passed through
 * {@link normalizeJoinCode}.
 */
export function isValidJoinCode(normalized: string): boolean {
  return JOIN_CODE_PATTERN.test(normalized)
}

/**
 * Formats a normalized join code for display, inserting a dash at its midpoint
 * (e.g. `BQ4XM9` -> `BQ4-XM9`).
 */
export function formatJoinCode(normalized: string): string {
  const half = LOBBY_JOIN_CODE_LENGTH / 2
  return normalized.slice(0, half) + '-' + normalized.slice(half)
}
