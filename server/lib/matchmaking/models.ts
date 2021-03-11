import sql from 'sql-template-strings'
import { MatchmakingType } from '../../../common/matchmaking'
import db, { DbClient } from '../db'
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
   * How many games in a row have had unexpected outcomes (either a loss with P > 0.5, or a win
   * with P < 0.5). Should be a value in the range [0, 2] (values higher than that apply extra
   * change to the K value and reset the streak to 0).
   */
  unexpectedStreak: number
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

export const DEFAULT_MATCHMAKING_RATING: Readonly<
  Omit<MatchmakingRating, 'userId' | 'matchmakingType'>
> = {
  rating: 1500,
  kFactor: 40,
  uncertainty: 200,
  unexpectedStreak: 0,
  numGamesPlayed: 0,
  lastPlayedDate: new Date(0),
}

type DbMatchmakingRating = Dbify<MatchmakingRating>

function fromDbMatchmakingRating(result: Readonly<DbMatchmakingRating>): MatchmakingRating {
  return {
    userId: result.user_id,
    matchmakingType: result.matchmaking_type,
    rating: result.rating,
    kFactor: result.k_factor,
    uncertainty: result.uncertainty,
    unexpectedStreak: result.unexpected_streak,
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

/**
 * Creates an initial matchmaking rating entry for a player, before they've played any games in that
 * matchmaking type. This should only be used when we have some lock on this player for that
 * matchmaking type (for instance, they have been put in the game activity registry).
 */
export async function createInitialMatchmakingRating(
  userId: number,
  matchmakingType: MatchmakingType,
  mmr = DEFAULT_MATCHMAKING_RATING,
): Promise<MatchmakingRating> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingRating>(sql`
      INSERT INTO matchmaking_ratings
        (user_id, matchmaking_type, rating, k_factor, uncertainty, unexpected_streak,
          num_games_played, last_played_date)
      VALUES
        (${userId}, ${matchmakingType}, ${mmr.rating}, ${mmr.kFactor}, ${mmr.uncertainty},
          ${mmr.unexpectedStreak}, ${mmr.numGamesPlayed}, ${mmr.lastPlayedDate})
      RETURNING *
    `)

    return fromDbMatchmakingRating(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Retrieves matchmaking ratings for multiple users at once, locking all of their rows from being
 * updated by other transactions until this one completes.
 */
export async function getMatchmakingRatingsWithLock(
  client: DbClient,
  userIds: number[],
  matchmakingType: MatchmakingType,
): Promise<MatchmakingRating[]> {
  const result = await client.query<DbMatchmakingRating>(sql`
    SELECT *
    FROM matchmaking_ratings
    WHERE user_id = ANY(${userIds}) AND matchmaking_type = ${matchmakingType}
    FOR UPDATE;
  `)
  return result.rows.map(r => fromDbMatchmakingRating(r))
}

/**
 * Updates the matchmaking rating for a particular user. This should only really be used in cases
 * where we either have an explicit lock on the row (see `getMatchmakingRatingsWithLock`) due to the
 * dependencies on data in other tables and order of operations.
 */
export async function updateMatchmakingRating(
  client: DbClient,
  mmr: Readonly<MatchmakingRating>,
): Promise<void> {
  await client.query(sql`
    UPDATE matchmaking_ratings
    SET
       rating = ${mmr.rating},
       k_factor = ${mmr.kFactor},
       uncertainty = ${mmr.uncertainty},
       unexpected_streak = ${mmr.unexpectedStreak},
       num_games_played = ${mmr.numGamesPlayed},
       last_played_date = ${mmr.lastPlayedDate}
    WHERE user_id = ${mmr.userId} AND matchmaking_type = ${mmr.matchmakingType};
  `)
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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function fromDbMatchmakingRatingChange(
  result: Readonly<DbMatchmakingRatingChange>,
): MatchmakingRatingChange {
  return {
    userId: result.user_id,
    matchmakingType: result.matchmaking_type,
    gameId: result.game_id,
    changeDate: result.change_date,
    outcome: result.outcome,
    rating: result.rating,
    ratingChange: result.rating_change,
    kFactor: result.k_factor,
    kFactorChange: result.k_factor_change,
    uncertainty: result.uncertainty,
    uncertaintyChange: result.uncertainty_change,
    probability: result.probability,
    unexpectedStreak: result.unexpected_streak,
  }
}

export async function insertMatchmakingRatingChange(
  client: DbClient,
  mmrChange: Readonly<MatchmakingRatingChange>,
): Promise<void> {
  const c = mmrChange

  await client.query(sql`
    INSERT INTO matchmaking_rating_changes
      (user_id, matchmaking_type, game_id, change_date, outcome, rating, rating_change, k_factor,
        k_factor_change, uncertainty, uncertainty_change, probability, unexpected_streak)
    VALUES
      (${c.userId}, ${c.matchmakingType}, ${c.gameId}, ${c.changeDate}, ${c.outcome}, ${c.rating},
        ${c.ratingChange}, ${c.kFactor}, ${c.kFactorChange}, ${c.uncertainty},
        ${c.uncertaintyChange}, ${c.probability}, ${c.unexpectedStreak});
  `)
}
