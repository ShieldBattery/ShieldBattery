import {
  EncodedMatchupString,
  GameDurationFilter,
  GameFormat,
  GameSortOption,
} from './games/game-filters'
import { RaceChar } from './races'
import { SbUserId } from './users/sb-user-id'

/**
 * A single player as recorded in a replay's header. `slot` matches the player's id in the replay,
 * `team` groups players for team games (and matchup computation).
 */
export interface ReplayLibraryPlayer {
  slot: number
  team: number
  name: string
  race: RaceChar
  isComputer: boolean
  /**
   * The player's ShieldBattery user id, if this replay was produced by ShieldBattery and the slot
   * maps to a real user. Absent for Battle.net replays and computer/empty slots.
   */
  sbUserId?: SbUserId
}

/**
 * A single indexed replay, as exposed to the renderer. Everything here is derived from the local
 * replay index (no per-request parsing), and is JSON-safe (timestamps are unix ms, no `Date`/`Map`).
 */
export interface ReplayLibraryEntry {
  /** Stable local id for this replay in the index. */
  id: number
  path: string
  /** Basename of `path`, provided for convenience. */
  fileName: string
  fileSize: number
  /** Game start time as unix ms (derived from the replay's random seed). */
  gameTime: number
  mapName: string
  /** Raw numeric game type, suitable for passing to `replayGameTypeToLabel`. */
  gameType: number
  durationFrames: number
  /**
   * The ShieldBattery game id, if this replay was produced by ShieldBattery. Absent for Battle.net
   * replays.
   */
  sbGameId?: string
  /** True if the replay could not be parsed; only `path`/`fileName`/`fileSize` are meaningful then. */
  parseError: boolean
  players: ReplayLibraryPlayer[]
  /** Unix ms when this replay was starred, or `undefined` if it isn't. */
  starredAt?: number
}

/** A local playlist grouping replays in manual order, as exposed to the renderer. */
export interface ReplayPlaylist {
  id: number
  name: string
  /** Number of replays currently in the playlist. */
  count: number
}

/**
 * Filters applied to a replay library query. All are optional; omitting a field means "don't filter
 * on it". Format/matchup semantics mirror the server's match-history filtering.
 */
export interface ReplayLibraryFilters {
  /** Case-insensitive substring to match against the map name. */
  mapName?: string
  /** Case-insensitive substring to match against any player's name. */
  playerName?: string
  /**
   * A raw numeric game type to match exactly, or `'others'` to match any game type outside
   * `FEATURED_REPLAY_GAME_TYPES`.
   */
  gameType?: number | 'others'
  duration?: GameDurationFilter
  /** Team-size shape (e.g. `1v1`). Required for `matchup` to take effect. */
  format?: GameFormat
  /** Encoded matchup filter with wildcards; only applied together with `format`. */
  matchup?: EncodedMatchupString
  /** Only match starred replays. */
  starred?: boolean
  /** Only match replays in this playlist, ordered by the playlist's manual order unless `sort` is set. */
  playlistId?: number
  /** Result ordering. Defaults to newest-first when omitted. */
  sort?: GameSortOption
  /** Number of matching entries to skip from the start of the results (for pagination). */
  offset?: number
  /** Maximum number of entries to return. When omitted, all matches are returned. */
  limit?: number
}

/** High-level status of the replay index, for surfacing indexing progress in the UI. */
export interface ReplayLibraryStatus {
  /** Number of replays currently in the index. */
  totalIndexed: number
  /** Number of replays currently starred. */
  starredCount: number
  /** Present while an initial/ongoing backfill is running. */
  backfill?: { done: number; total: number }
  /** The absolute path of the folder being indexed. */
  watchedFolder: string
}
