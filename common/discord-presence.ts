import { makeSbLobbyId, SbLobbyId } from './lobbies/sb-lobby-id'
import { isPrettyId } from './pretty-id'

/**
 * The Discord application each release channel publishes Rich Presence as. An application's id is
 * public (Discord shows it to anyone looking at the activity), so these live with the rest of the
 * per-channel constants rather than in deployment config.
 */
export const DISCORD_APPLICATION_IDS = {
  production: '1563038471491428483',
  staging: '1563238746143461386',
  local: '1563239005221421247',
} as const

/**
 * A Rich Presence activity as the renderer hands it to the main process: the part of the Discord
 * SDK's activity that ShieldBattery fills in. Discord shows the application's name, then `details`,
 * then `state` followed by the party's size. Every string must be between 2 and 128 characters,
 * which the SDK enforces by rejecting the whole activity.
 */
export interface DiscordActivity {
  /** What the user is doing, e.g. the game mode and matchup. */
  details?: string
  /** The line below `details`, e.g. the map. */
  state?: string
  /** When the activity started, in milliseconds since the Unix epoch. Discord counts up from it. */
  startTimestamp?: number
  /** The square image beside the text. */
  largeImage?: DiscordActivityImage
  /** The circle Discord draws over the large image's corner. */
  smallImage?: DiscordActivityImage
  /** Makes the activity joinable from Discord, as long as the party has room. */
  party?: DiscordActivityParty
}

export interface DiscordActivityImage {
  /**
   * The key of an art asset uploaded to the Discord application (see docs/DISCORD_SDK.md), or an
   * https URL of up to 300 characters.
   */
  image: string
  /** The tooltip on hover, 2 to 128 characters. */
  text?: string
}

export interface DiscordActivityParty {
  /**
   * Identifies the party, so Discord groups everyone in it together. Discord only gets a hash of it,
   * since it shows a party's id to anyone who can see the activity.
   */
  id: string
  currentSize: number
  maxSize: number
  /**
   * Who can join without asking. With 'public', the user's Discord friends can (as their Discord
   * privacy settings allow) and others ask to join; with 'private', everyone asks. Discord hands the
   * join secret only to those who join or whose request the user accepts, and to people the user
   * invites from Discord.
   */
  privacy: 'public' | 'private'
  /** Handed to whoever joins from Discord (see `parseDiscordJoinSecret`). */
  joinSecret: string
}

const LOBBY_JOIN_SECRET_PREFIX = 'lobby:'

/**
 * Returns the join secret for a lobby's activity. It holds the lobby's id, which lets its holder
 * into the lobby even if it's unlisted, the same as a link to the lobby.
 */
export function makeLobbyJoinSecret(lobbyId: SbLobbyId): string {
  return LOBBY_JOIN_SECRET_PREFIX + lobbyId
}

/**
 * Returns what a join secret from Discord asks to join, or `undefined` if it isn't one this app
 * made. The secret arrives from Discord, so it's treated as untrusted input.
 */
export function parseDiscordJoinSecret(
  secret: string,
): { type: 'lobby'; lobbyId: SbLobbyId } | undefined {
  if (!secret.startsWith(LOBBY_JOIN_SECRET_PREFIX)) {
    return undefined
  }
  const lobbyId = secret.slice(LOBBY_JOIN_SECRET_PREFIX.length)
  return isPrettyId(lobbyId) ? { type: 'lobby', lobbyId: makeSbLobbyId(lobbyId) } : undefined
}
