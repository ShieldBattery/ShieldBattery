import { SlotType } from '../lobbies/slot'
import { MapInfoJson } from '../maps'
import { MatchmakingDivision, MatchmakingType } from '../matchmaking'
import { BwTurnRate, BwUserLatency } from '../network'
import { RaceChar } from '../races'
import { SbUser } from '../users/sb-user'
import { SbUserId } from '../users/sb-user-id'
import { GameType } from './game-type'

/** A matchmaking player's standing in the match's mode, as shown on the game's loading screen. */
export interface GamePlayerRank {
  userId: SbUserId
  division: MatchmakingDivision
  /** The player's rating, omitted while they're still in placement matches. */
  rating?: number
}

/**
 * Configuration for a particular player in a game. This is similar to Lobby's `Slot` structure,
 * but has been flattened slightly to remove the need to send info about teams.
 */
export interface PlayerInfo {
  /** The ID of the player slot, an opaque string. */
  id: string
  /** Shieldbattery user ID of the player. Only set for 'human' and 'observer' */
  userId?: SbUserId
  /** The race set for this slot. */
  race?: RaceChar
  /** The BW player ID for this slot (a number between 0 and 7). */
  playerId?: number
  /** The ID of the team this slot is a part of. */
  teamId: number
  /** The type of this slot. */
  type: SlotType
  /** The BW id of the type of this slot. */
  typeId: number
}

/**
 * How a series is played, as far as showing it goes. Only the facts travel; any wording about the
 * format is composed by whoever displays it.
 */
export type SeriesOverlayFormat = { kind: 'bestOf'; length: number }

/** One side of a series, as the observer overlay shows it. */
export interface SeriesOverlaySide {
  /** Text a person typed to name the side. Nothing sets it yet. */
  caption?: string
  /** The number shown for the side. For a best-of, the games it has won so far. */
  score: number
  /** The side's members who are seated as players in this game. */
  players: SbUserId[]
}

/**
 * Where a series stood when one of its games launched, for the observer overlay to show. Only text
 * a person typed (`title`, `caption`, `lines`) travels as text.
 */
export interface SeriesOverlay {
  /** Text a person typed to name the series. */
  title?: string
  format: SeriesOverlayFormat
  /** 1-based. */
  gameNumber: number
  sides: [SeriesOverlaySide, SeriesOverlaySide]
  /**
   * Text lines a person typed for the casters' scoreboard, in the order they're shown. At most two,
   * none of them empty; absent when there are none.
   */
  lines?: string[]
  /** Fully-qualified URL of a PNG logo for the casters' scoreboard. Absent when there is none. */
  logoUrl?: string
}

export interface ReplayMapInfo {
  isReplay: true
  path: string
  /** The frame to seek the replay to as soon as it starts, if not its beginning. */
  startFrame?: number
}

export function isReplayLaunchConfig(config: GameLaunchConfig) {
  return isReplayMapInfo(config.setup.map)
}

export function isReplayMapInfo(map: MapInfoJson | ReplayMapInfo): map is ReplayMapInfo {
  return (map as ReplayMapInfo).isReplay
}

export interface GameSetup {
  /**
   * The id of the game, used by the server to identify it for sending commands and receiving
   * results.
   */
  gameId: string
  /**
   * The name of the game. Not really that important generally, as we don't display this directly
   * to users.
   */
  name: string
  map: MapInfoJson | ReplayMapInfo
  /**
   * The file path of the map file. Note that this gets set during the launch process, it's not
   * provided directly by the code that triggers the launch.
   * TODO(tec27): make it provided directly instead?
   */
  mapPath?: string
  gameType: GameType
  gameSubType: number
  slots: PlayerInfo[]
  /**
   * The player whose game process creates the game's network session. For netcode v2 games this
   * is always a playing human (never an observer) when the game has one, since the session creator
   * holds network id 0 and StarCraft only runs commands from player network ids 0..7.
   */
  host: PlayerInfo
  /**
   * The user to name as the game's creator (e.g. in the replay header), if that isn't `host`. Set
   * when a lobby's host is observing, so the lobby host stays the named creator even though a
   * playing human creates the network session.
   */
  creatorUserId?: SbUserId
  users: SbUser[]
  /** For matchmaking, each player's standing in the match's mode going into the game. */
  ranks?: GamePlayerRank[]
  /** The matchmaking type of the match this game is for, or `undefined` for a lobby game. */
  matchmakingType?: MatchmakingType
  /**
   * Whether changing allies during the game is disabled. Optional, defaults to false (i.e. use
   * the default for the game mode). */
  disableAllianceChanges?: boolean
  /**
   * Turn rate for the game. 0 means dynamic, other values mean N turns per second. If not
   * provided, defaults to dynamic.
   */
  turnRate?: BwTurnRate | 0
  /**
   * The initial user latency setting to use. If not set, will default to Low.
   */
  userLatency?: BwUserLatency
  /**
   * Whether to use legacy unit/sprite limits (instead of the extended ones that are default in
   * SC:R).
   */
  useLegacyLimits?: boolean
  /**
   * Whether to play without the ShieldBattery game logic fixes that make replays play back
   * differently in StarCraft: Remastered without ShieldBattery. The game records which fixes it
   * turned off in the replay.
   */
  starcraftCompatibleReplays?: boolean
  /**
   * Where the series this game is part of stood when the game launched, for the observer overlay to
   * show. Only set for lobby games launched while a series runs, and fixed at launch.
   */
  seriesOverlay?: SeriesOverlay
  seed: number
  /**
   * Whether this game uses netcode v2 (rally-point2). When set, each client must generate a
   * per-session keypair and submit its public key to the server during loading; the server
   * responds with a `setNetcodeV2Setup` event carrying the session token/relays/roster, which
   * must be delivered to the game process before its game setup.
   */
  useNetcodeV2?: boolean
  /**
   * The code used to submit results for this game to the server. This is secret and unique per
   * player in the game. In certain cases (when observing, or when watching a replay), a result
   * code may not be given, meaning no result is to be reported.
   */
  resultCode?: string
  /** True if the local user is currently restricted from sending messages. */
  isChatRestricted?: boolean
}

/** Configuration info for launching a local game client to play a specific game. */
export interface GameLaunchConfig {
  /** The user currently logged into the application and playing the game. */
  localUser: SbUser
  /**
   * The SbUserIds the local user has blocked. Their chat messages are hidden in-game (matching the
   * app's behavior in chat/whispers).
   */
  blockedUsers: SbUserId[]
  /**
   * The filename template for this game's auto-saved replay (see
   * `common/replay-name-template.ts`). Unset for replay playback, which saves no replay; the game
   * uses the default template when it's missing.
   */
  replayNameTemplate?: string
  /** Setup for this specific server. */
  serverConfig: {
    /** The URL of the server, so that the game client can communicate with it as necessary. */
    serverUrl: string
  }
  /** Setup configuration for the game, such as the map, game type, etc. */
  setup: GameSetup
  /**
   * The language the app's UI is currently displayed in (an i18next language tag such as `ko` or
   * `zh-Hans`), so the game client renders its own UI in the same language.
   */
  language: string
}
