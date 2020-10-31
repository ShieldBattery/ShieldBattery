/**
 * A string representation of all the matchmaking types that we support.
 */
export type MatchmakingType = '1v1'

/**
 * The body data of the API route for adding new matchmaking times.
 */
export interface AddMatchmakingTimeBody {
  /** The start date of the new matchmaking time. */
  startDate: number
  /** A boolean flag indicating whether the matchmaking is enabled or not. */
  enabled: boolean
}
