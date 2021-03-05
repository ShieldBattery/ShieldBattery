import { GameType } from './constants'
import { MapInfo } from './maps'
import { RaceChar } from './races'

// TODO(tec27): Pretty sure this is some lobby structure we could re-use/share? I built it from the
// Rust version so I dunno
/** Configuration for a particular player in a game. */
export interface PlayerInfo {
  /** The ID of the player slot, an opaque string. */
  id: string
  /** The name of the player in this slot (e.g. their username). */
  name: string
  /** The race set for this slot. */
  race?: RaceChar
  /** The BW player ID for this slot (a number between 0 and 7). */
  playerId?: number
  /** The ID of the team this slot is a part of. */
  teamId?: number
  /** The type of this slot. */
  type:
    | 'human'
    | 'observer'
    | 'computer'
    | 'controlledOpen'
    | 'controlledClosed'
    | 'open'
    | 'closed'
  /** The BW id of the type of this slot. */
  typeId: number
  /** Shieldbattery user ID of the player. Only set for 'human' and 'observer' */
  userId?: number
}

export interface ReplayMapInfo {
  isReplay: true
  path: string
}

export function isReplayMapInfo(map: MapInfo | ReplayMapInfo): map is ReplayMapInfo {
  return (map as ReplayMapInfo).isReplay
}

/** Configuration info for launching a local game client to play a specific game. */
export interface GameConfig {
  /** The user currently logged into the application and playing the game. */
  localUser: {
    id: number
    name: string
  }
  /** The current settings for the game. */
  settings: Record<string, any> // TODO(tec27): this can definitely be typed as an interface
  /** Setup configuration for the game, such as the map, game type, etc. */
  setup: {
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
    map: MapInfo | ReplayMapInfo
    /**
     * The file path of the map file. Note that this gets set during the launch process, it's not
     * provided directly by the code that triggers the launch.
     * TODO(tec27): make it provided directly instead?
     */
    mapPath?: string
    gameType: GameType
    slots: PlayerInfo[]
    host: PlayerInfo
    seed: number
    /**
     * The code used to submit results for this game to the server. This is secret and unique per
     * player in the game.
     */
    resultCode: string
    /** The URL of the server, so that the game client can communicate with it as necessary. */
    serverUrl: string
  }
}

/** A network route configuration for communication between two players in a game. */
export interface GameRoute {
  /** The ID of the player who will be connected to over this network route. */
  for: string
  /** The rally-point server to connect to for this route. */
  server: string
  /** The ID of the route, used to identify it to the rally-point server. */
  routeId: string
  /** The ID of the local player, used to identify themselves to the rally-point server. */
  playerId: string
}
