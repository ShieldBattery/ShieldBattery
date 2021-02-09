import { MapInfo } from './maps'
import { RaceChar } from './races'

/**
 * A string representation of each of the matchmaking types that we support.
 */
export enum MatchmakingType {
  Match1v1 = '1v1',
}

export const ALL_MATCHMAKING_TYPES = Object.values(MatchmakingType)

export function isValidMatchmakingType(type: string) {
  return Object.values(MatchmakingType).includes(type as MatchmakingType)
}

/**
 * The body data of the API route for adding new matchmaking times.
 */
export interface AddMatchmakingTimeBody {
  /**
   * The start date of the new matchmaking time. As with the JavaScript's `Date` object, the number
   * should represent the amount of milliseconds since January 1st 1970 UTC. No automatic time zone
   * conversions are done on the server side. Similarly, daylight savings time is also not accounted
   * for and should be dealt with manually.
   */
  startDate: number
  /** A boolean flag indicating whether the matchmaking is enabled or not. */
  enabled: boolean
}

/**
 * Describes a user's preferences for finding a match in matchmaking.
 *
 * TODO(tec27): The structure of this likely needs to differ based on matchmaking type?
 */
export interface MatchmakingPreferences {
  matchmakingType: MatchmakingType
  race: RaceChar
  useAlternateRace: boolean
  alternateRace: RaceChar
  /**
   * The ID of the map pool the preferred maps were set with. This can be used to determine if the
   * user's selections might be outdated.
   */
  mapPoolId: string
  /** An array of map IDs that the user prefers to play on. */
  preferredMaps: string[]
}

/**
 * The version of `MatchmakingPreferences` that is actually stored in the database. This contains
 * information that is useful for queries/updates but not generally needed/desired by the client.
 */
export interface StoredMatchmakingPreferences extends MatchmakingPreferences {
  userId: number
  updatedAt: Date
}

/**
 * The type expected by the API at `POST /matchmakingPreferences/:matchmakingType`.
 */
export type UpdateMatchmakingPreferencesBody = Omit<
  MatchmakingPreferences,
  'matchmakingType' | 'mapPoolId'
>

export interface GetPreferencesPayload {
  preferences: MatchmakingPreferences
  mapPoolOutdated: boolean
  mapInfo: MapInfo[]
}
