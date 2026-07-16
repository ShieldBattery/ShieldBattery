import { EncodedMatchupString, GameDurationFilter, GameFormat } from './games/game-filters'
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
}

/**
 * Filters applied to a replay library query. All are optional; omitting a field means "don't filter
 * on it". Format/matchup semantics mirror the server's match-history filtering.
 */
export interface ReplayLibraryFilters {
  /** `sb` = produced by ShieldBattery (has an SB game id), `bnet` = everything else. */
  source?: 'sb' | 'bnet'
  mapName?: string
  /** Raw numeric game type to match exactly. */
  gameType?: number
  duration?: GameDurationFilter
  /** Team-size shape (e.g. `1v1`). Required for `matchup` to take effect. */
  format?: GameFormat
  /** Encoded matchup filter with wildcards; only applied together with `format`. */
  matchup?: EncodedMatchupString
  /** Free-text prefix search over player names and map name. */
  searchQuery?: string
}

/** High-level status of the replay index, for surfacing indexing progress in the UI. */
export interface ReplayLibraryStatus {
  /** Number of replays currently in the index. */
  totalIndexed: number
  /** Present while an initial/ongoing backfill is running. */
  backfill?: { done: number; total: number }
  /** The absolute path of the folder being indexed. */
  watchedFolder: string
}
