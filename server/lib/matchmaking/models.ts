import sql from 'sql-template-strings'
import { MatchmakingType } from '../../../common/matchmaking'
import db from '../db'
import { Dbify } from '../db/types'

export interface MatchmakingRating {
  userId: number
  matchmakingType: MatchmakingType
  /** The user's current MMR. */
  rating: number
  /**
   * The user's current K value, used for determining the magnitude of MMR changes. In the range
   * [24, 40], starting out at 40 for the first 25 games.
   */
  kFactor: number
  /**
   * The amount of uncertainty in the user's current rating, used to determine the range to search
   * for opponents within. In the range [80, 600], starting at 200 for a new player.
   */
  uncertainty: number
  /**
   * The number of matchmaking games this user has played, used to determine how the K value
   * changes.
   */
  numGamesPlayed: number
  /**
   * The date of the last game this user has played (or when its results were tabulated). This is
   * used to determine when users are inactive.
   */
  lastPlayedDate: Date
}

type DbMatchmakingRating = Dbify<MatchmakingRating>

function fromDbMatchmakingRating(result: DbMatchmakingRating): MatchmakingRating {
  return {
    userId: result.user_id,
    matchmakingType: result.matchmaking_type,
    rating: result.rating,
    kFactor: result.k_factor,
    uncertainty: result.uncertainty,
    numGamesPlayed: result.num_games_played,
    lastPlayedDate: result.last_played_date,
  }
}

/**
 * Retrieves the current `MatchmakingRating` for a user, or `undefined` if the user has no MMR.
 */
export async function getMatchmakingRating(
  userId: number,
  matchmakingType: MatchmakingType,
): Promise<MatchmakingRating | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingRating>(sql`
      SELECT *
      FROM matchmaking_ratings
      WHERE user_id = ${userId} AND matchmaking_type = ${matchmakingType};
    `)
    return result.rowCount > 0 ? fromDbMatchmakingRating(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export type MatchmakingResult = 'loss' | 'win'

export interface MatchmakingRatingChange {
  userId: number
  matchmakingType: MatchmakingType
  gameId: string
  /** The date when the change took place. This is used for sorting the changes. */
  changeDate: Date

  /** Whether the game was a loss or a win. */
  outcome: MatchmakingResult
  /** The final rating after the change took place. */
  rating: number
  /** The change that was applied to the rating for this game. */
  ratingChange: number
  /** The final K value after the change took place. */
  kFactor: number
  /** The change that was applied to the K value for this game. */
  kFactorChange: number
  /** The final uncertainty value after the change took place. */
  uncertainty: number
  /** The change that was applied to the uncertainty value for this game. */
  uncertaintyChange: number
  /**
   * The probability value (P) of this player winning the game. In the range [0, 1], with a value
   * of 0.5 meaning there is an equal probability of losing or winning.
   */
  probability: number
  /**
   * How many games in a row have had unexpected outcomes (either a loss with P > 0.5, or a win
   * with P < 0.5). Should be a value in the range [0, 2] (values higher than that apply extra
   * change to the K value and reset the streak to 0).
   */
  unexpectedStreak: number
}

type DbMatchmakingRatingChange = Dbify<MatchmakingRatingChange>
