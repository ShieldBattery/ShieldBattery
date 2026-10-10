/**
 * The per-channel custom URL schemes the desktop app registers as OS-level protocol handlers for
 * deep links. Each install registers only its own channel's scheme, so side-by-side channel
 * installs never fight over one registry key. Link *parsers* accept any of them: a link for
 * another channel still parses into a lobby id and then simply fails to resolve against this
 * channel's server, which beats rejecting it as unrecognizable.
 */
export const DEEP_LINK_SCHEMES = {
  production: 'shieldbattery',
  staging: 'shieldbattery-staging',
  local: 'shieldbattery-local',
} as const

/** Every deep-link scheme any channel registers; the allowlist for parsing pasted links. */
export const ALL_DEEP_LINK_SCHEMES: ReadonlyArray<string> = Object.values(DEEP_LINK_SCHEMES)

/**
 * A link into a game: its results page, and optionally a game time to start watching its replay
 * from.
 */
export interface GameDeepLink {
  gameId: string
  /** Game time to start the replay at, in seconds. */
  timestampSeconds?: number
}
