import {
  MatchmakingCompletion,
  MatchmakingResult,
  MatchmakingSeason,
  MatchmakingType,
  SeasonId,
} from '../../../common/matchmaking.js'
import { RaceStats } from '../../../common/races.js'
import { SbUserId } from '../../../common/users/sb-user.js'
import { escapeSearchString } from '../db/escape-search-string.js'
import db, { DbClient } from '../db/index.js'
import { sql } from '../db/sql.js'
import { Dbify } from '../db/types.js'

export interface MatchmakingRating extends RaceStats {
  userId: SbUserId
  matchmakingType: MatchmakingType
  seasonId: SeasonId
  /**
   * The user's current MMR. This value is (generally) maintained between seasons, and represents
   * the midpoint of the user's predicted skill level.
   */
  rating: number
  /**
   * The amount of uncertainty in the user's current rating, used to determine the range to search
   * for opponents within and the magnitude of rating changes for a win/loss.
   */
  uncertainty: number
  /**
   * The degree of expected fluctuation in a player's rating. This value is high when a player has
   * erratic performances and low when the player performs at a consistent level.
   */
  volatility: number
  /**
   * The user's current seasonal points. This value is reset each season, and is effectively the
   * rating they have "earned". It is used for determining rankings.
   */
  points: number
  /**
   * Whether this user's points have converged with their rating for this season. If points have not
   * converged (that is, they are lower than 4 * their division's base rating and have not surpassed
   * that value this season), they will receive extra points for wins (on top of the normal bonus
   * pool) to help them get to an appropriate point total more quickly.
   */
  pointsConverged: boolean
  /**
   * The amount of the bonus point pool that has been used by this user. Over the course of the
   * season, users accrue bonus points at a regular rate. Bonus points are used to either increase
   * the point reward for wins, or decrease the point loss for losses. This number is used to
   * determine how much of the pool is left when calculating point changes.
   */
  bonusUsed: number
  /**
   * The number of matchmaking games this user has played during this season.
   */
  numGamesPlayed: number
  /**
   * The number of games this user has played for this matchmaking type since the last MMR reset.
   * This can be used to determine if the user is still in placements.
   */
  lifetimeGames: number
  /**
   * The date of the last game this user has played (or when its results were tabulated). This is
   * used to determine when users are inactive.
   */
  lastPlayedDate: Date
  /** The number of games this user has won in this matchmaking type during this season. */
  wins: number
  /** The number of games this user has lost in this matchmaking type during this season. */
  losses: number
}

export const DEFAULT_MATCHMAKING_RATING: Readonly<
  Omit<MatchmakingRating, 'userId' | 'matchmakingType' | 'seasonId'>
> = {
  rating: 1500,
  uncertainty: 350,
  volatility: 0.06,
  points: 0,
  pointsConverged: false,
  bonusUsed: 0,
  numGamesPlayed: 0,
  lifetimeGames: 0,
  lastPlayedDate: new Date(0),
  wins: 0,
  losses: 0,
  pWins: 0,
  pLosses: 0,
  tWins: 0,
  tLosses: 0,
  zWins: 0,
  zLosses: 0,
  rWins: 0,
  rLosses: 0,
  rPWins: 0,
  rPLosses: 0,
  rTWins: 0,
  rTLosses: 0,
  rZWins: 0,
  rZLosses: 0,
}

type DbMatchmakingRating = Dbify<MatchmakingRating>

function fromDbMatchmakingRating(result: Readonly<DbMatchmakingRating>): MatchmakingRating {
  return {
    userId: result.user_id,
    matchmakingType: result.matchmaking_type,
    seasonId: result.season_id,
    rating: result.rating,
    uncertainty: result.uncertainty,
    volatility: result.volatility,
    points: result.points,
    pointsConverged: result.points_converged,
    bonusUsed: result.bonus_used,
    numGamesPlayed: result.num_games_played,
    lifetimeGames: result.lifetime_games,
    lastPlayedDate: result.last_played_date,
    wins: result.wins,
    losses: result.losses,
    pWins: result.p_wins,
    pLosses: result.p_losses,
    tWins: result.t_wins,
    tLosses: result.t_losses,
    zWins: result.z_wins,
    zLosses: result.z_losses,
    rWins: result.r_wins,
    rLosses: result.r_losses,
    rPWins: result.r_p_wins,
    rPLosses: result.r_p_losses,
    rTWins: result.r_t_wins,
    rTLosses: result.r_t_losses,
    rZWins: result.r_z_wins,
    rZLosses: result.r_z_losses,
  }
}

/**
 * Retrieves the current `MatchmakingRating` for a user, or `undefined` if the user has no MMR. This
 * information will be up-to-date as of currently submitted game results.
 */
export async function getMatchmakingRating(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
  seasonId: SeasonId,
): Promise<MatchmakingRating | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingRating>(sql`
      SELECT *
      FROM matchmaking_ratings
      WHERE user_id = ${userId}
        AND matchmaking_type = ${matchmakingType}
        AND season_id = ${seasonId};
    `)
    return result.rowCount ? fromDbMatchmakingRating(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Creates an initial matchmaking rating entry for a player, before they've played any games in that
 * matchmaking type for the season. This should only be used when we have some lock on this player
 * for that matchmaking type (for instance, they have been put in the game activity registry).
 *
 * This will try to utilize a past MMR record (from a previous season, including from users playing
 * from the same machine) if one can be found.
 */
export async function createInitialMatchmakingRating(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
  season: MatchmakingSeason,
  connectedUsers: ReadonlyArray<SbUserId>,
): Promise<MatchmakingRating> {
  const { client, done } = await db()
  try {
    // First, try to find a previous season's MMR that hasn't been reset
    const previousMmrs = await client.query<
      { reset: boolean; season_id: SeasonId } & Partial<DbMatchmakingRating>
    >(sql`
      SELECT ms.reset_mmr as reset, ms.id as season_id, mr.*
      FROM matchmaking_seasons ms
      LEFT JOIN matchmaking_ratings mr
      ON ms.id = mr.season_id
      AND mr.user_id = ANY(${[userId, ...connectedUsers]})
      AND mr.matchmaking_type = ${matchmakingType}
      WHERE
        (mr.user_id = ${userId} AND ms.start_date < ${season.startDate}) OR
        (mr.user_id != ${userId} AND ms.start_date <= ${season.startDate}) OR
        (mr.user_id IS NULL)
      ORDER BY ms.start_date DESC, mr.last_played_date DESC;
    `)

    let previousMmr: MatchmakingRating | undefined
    let foundLifetimeGames = false
    let lifetimeGames = 0
    for (const row of previousMmrs.rows) {
      // row.user_id being non-null means we found a previous MMR
      if (row.user_id) {
        if (season.resetMmr && row.season_id !== season.id) {
          // Special handling here to allow for smurf detection in the current season even if it's a
          // reset season, but not allow any older MMR entries
          break
        }

        // NOTE(tec27): With this query either all the columns will be set or none of them will,
        // so this cast is safe
        if (!previousMmr) {
          previousMmr = fromDbMatchmakingRating(row as DbMatchmakingRating)
        }
        if (!foundLifetimeGames && row.user_id === userId) {
          // We try to use the lifetime games only from the current account to make it less
          // obvious when we've detected a smurf
          lifetimeGames = row.lifetime_games!
          foundLifetimeGames = true
        }

        if (previousMmr && foundLifetimeGames) {
          break
        }
      }

      if (row.reset) {
        // Once we find a reset season without finding a previous MMR, all MMRs past that point
        // are void
        break
      }
    }

    const mmr: MatchmakingRating = previousMmr
      ? {
          ...DEFAULT_MATCHMAKING_RATING,
          userId,
          matchmakingType,
          seasonId: season.id,
          rating: previousMmr.rating,
          uncertainty: previousMmr.uncertainty,
          volatility: previousMmr.volatility,
          lastPlayedDate: previousMmr.lastPlayedDate,
          lifetimeGames,
        }
      : {
          ...DEFAULT_MATCHMAKING_RATING,
          userId,
          matchmakingType,
          seasonId: season.id,
        }

    const result = await client.query<DbMatchmakingRating>(sql`
      INSERT INTO matchmaking_ratings
        (user_id, matchmaking_type, season_id, rating, uncertainty, volatility,
          points, points_converged, bonus_used, num_games_played, last_played_date, lifetime_games,
          wins, losses,
          p_wins, p_losses,
          t_wins, t_losses,
          z_wins, z_losses,
          r_wins, r_losses, r_p_wins, r_p_losses, r_t_wins, r_t_losses, r_z_wins, r_z_losses)
      VALUES
        (${userId}, ${matchmakingType}, ${season.id}, ${mmr.rating},
          ${mmr.uncertainty}, ${mmr.volatility}, ${mmr.points}, ${mmr.pointsConverged},
          ${mmr.bonusUsed}, ${mmr.numGamesPlayed}, ${mmr.lastPlayedDate}, ${mmr.lifetimeGames},
          ${mmr.wins}, ${mmr.losses}, ${mmr.pWins}, ${mmr.pLosses}, ${mmr.tWins}, ${mmr.tLosses},
          ${mmr.zWins}, ${mmr.zLosses}, ${mmr.rWins}, ${mmr.rLosses}, ${mmr.rPWins},
          ${mmr.rPLosses}, ${mmr.rTWins}, ${mmr.rTLosses}, ${mmr.rZWins}, ${mmr.rZLosses})
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
  userIds: SbUserId[],
  matchmakingType: MatchmakingType,
  seasonId: SeasonId,
): Promise<MatchmakingRating[]> {
  const result = await client.query<DbMatchmakingRating>(sql`
    SELECT *
    FROM matchmaking_ratings
    WHERE user_id = ANY(${userIds})
      AND matchmaking_type = ${matchmakingType}
      AND season_id = ${seasonId}
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
       uncertainty = ${mmr.uncertainty},
       volatility = ${mmr.volatility},
       points = ${mmr.points},
       points_converged = ${mmr.pointsConverged},
       bonus_used = ${mmr.bonusUsed},
       num_games_played = ${mmr.numGamesPlayed},
       last_played_date = ${mmr.lastPlayedDate},
       lifetime_games = ${mmr.lifetimeGames},
       wins = ${mmr.wins},
       losses = ${mmr.losses},
       p_wins = ${mmr.pWins},
       p_losses = ${mmr.pLosses},
       t_wins = ${mmr.tWins},
       t_losses = ${mmr.tLosses},
       z_wins = ${mmr.zWins},
       z_losses = ${mmr.zLosses},
       r_wins = ${mmr.rWins},
       r_losses = ${mmr.rLosses},
       r_p_wins = ${mmr.rPWins},
       r_p_losses = ${mmr.rPLosses},
       r_t_wins = ${mmr.rTWins},
       r_t_losses = ${mmr.rTLosses},
       r_z_wins = ${mmr.rZWins},
       r_z_losses = ${mmr.rZLosses}
    WHERE user_id = ${mmr.userId}
      AND matchmaking_type = ${mmr.matchmakingType}
      AND season_id = ${mmr.seasonId};
  `)
}

// TODO(tec27): Remove username from this and get user data in another query
export interface GetRankingsResult extends RaceStats {
  matchmakingType: MatchmakingType
  rank: number
  userId: SbUserId
  username: string
  rating: number
  points: number
  bonusUsed: number
  wins: number
  losses: number
  lifetimeGames: number
  lastPlayedDate: Date
}

type DbGetRankingsResult = Dbify<GetRankingsResult>

function fromDbGetRankingsResult(r: DbGetRankingsResult): GetRankingsResult {
  return {
    matchmakingType: r.matchmaking_type,
    // NOTE(tec27): RANK() is a bigint so this is actually a string
    rank: Number(r.rank),
    userId: r.user_id,
    username: r.username,
    rating: r.rating,
    points: r.points,
    bonusUsed: r.bonus_used,
    wins: r.wins,
    losses: r.losses,
    lifetimeGames: r.lifetime_games,
    pWins: r.p_wins,
    pLosses: r.p_losses,
    tWins: r.t_wins,
    tLosses: r.t_losses,
    zWins: r.z_wins,
    zLosses: r.z_losses,
    rWins: r.r_wins,
    rLosses: r.r_losses,
    rPWins: r.r_p_wins,
    rPLosses: r.r_p_losses,
    rTWins: r.r_t_wins,
    rTLosses: r.r_t_losses,
    rZWins: r.r_z_wins,
    rZLosses: r.r_z_losses,
    lastPlayedDate: r.last_played_date,
  }
}

/**
 * Returns a list of players sorted by rank, and optionally filtered by a search query, for a
 * particular matchmaking type.
 */
export async function getRankings(
  matchmakingType: MatchmakingType,
  searchStr?: string,
): Promise<GetRankingsResult[]> {
  const { client, done } = await db()
  try {
    let query = sql`
      SELECT r.matchmaking_type, r.rank, u.name AS username, r.user_id, r.rating, r.points,
        r.bonus_used, r.wins, r.losses, r.lifetime_games,
        r.p_wins, r.p_losses,
        r.t_wins, r.t_losses,
        r.z_wins, r.z_losses,
        r.r_wins, r.r_losses,
        r.r_p_wins, r.r_p_losses, r.r_t_wins, r.r_t_losses, r.r_z_wins, r.r_z_losses,
        r.last_played_date
      FROM ranked_matchmaking_ratings_view r JOIN users u
        ON r.user_id = u.id
      WHERE r.matchmaking_type = ${matchmakingType}
    `

    if (searchStr) {
      const escapedStr = `%${escapeSearchString(searchStr)}%`
      query = query.append(sql`
        AND u.name ILIKE ${escapedStr}
      `)
    }

    query = query.append(sql`
      ORDER BY r.rank;
    `)

    const result = await client.query<Dbify<GetRankingsResult>>(query)

    return result.rows.map(r => fromDbGetRankingsResult(r))
  } finally {
    done()
  }
}

// TODO(tec27): Just return all the ranks for a user instead?
export async function getRankForUser(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
): Promise<GetRankingsResult | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<Dbify<GetRankingsResult>>(sql`
      SELECT r.matchmaking_type, r.rank, u.name AS username, r.user_id, r.rating, r.points,
        r.bonus_used, r.lifetime_games, r.wins, r.losses,
        r.p_wins, r.p_losses,
        r.t_wins, r.t_losses,
        r.z_wins, r.z_losses,
        r.r_wins, r.r_losses,
        r.r_p_wins, r.r_p_losses, r.r_t_wins, r.r_t_losses, r.r_z_wins, r.r_z_losses,
        r.last_played_date
      FROM ranked_matchmaking_ratings_view r JOIN users u
        ON r.user_id = u.id
      WHERE r.matchmaking_type = ${matchmakingType} AND r.user_id = ${userId};
    `)

    return result.rows.length > 0 ? fromDbGetRankingsResult(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Returns a user's rating/rank info, with everything except for the rank calculated from "current"
 * data instead of the batch-updated rank info. Any matchmaking types that the user has not
 * completed a game in will not be included in the result.
 */
export async function getInstantaneousRanksForUser(
  userId: SbUserId,
  seasonId: SeasonId,
): Promise<GetRankingsResult[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<Dbify<GetRankingsResult>>(sql`
      SELECT r.matchmaking_type, v.rank, u.name AS username, r.user_id, r.rating, r.points,
        r.bonus_used, r.lifetime_games, r.wins, r.losses,
        r.p_wins, r.p_losses,
        r.t_wins, r.t_losses,
        r.z_wins, r.z_losses,
        r.r_wins, r.r_losses,
        r.r_p_wins, r.r_p_losses, r.r_t_wins, r.r_t_losses, r.r_z_wins, r.r_z_losses,
        r.last_played_date
      FROM ranked_matchmaking_ratings_view v
        JOIN users u ON v.user_id = u.id
        JOIN matchmaking_ratings r ON r.user_id = u.id
      WHERE r.season_id = ${seasonId} AND r.user_id = ${userId} AND r.num_games_played > 0;
    `)

    return result.rows.map(r => fromDbGetRankingsResult(r))
  } finally {
    done()
  }
}

/**
 * Triggers an updated to the pre-ranked view of matchmaking ratings. This should be run
 * periodically to make fresh data available to `getRankings` calls.
 */
export async function refreshRankings(): Promise<void> {
  const { client, done } = await db()
  try {
    // TODO(tec27): Store the refresh time so we can display it to clients
    await client.query(sql`
      REFRESH MATERIALIZED VIEW CONCURRENTLY ranked_matchmaking_ratings_view
    `)
  } finally {
    done()
  }
}

export interface MatchmakingRatingChange {
  userId: SbUserId
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
  /** The final uncertainty value after the change took place. */
  uncertainty: number
  /** The change that was applied to the uncertainty value for this game. */
  uncertaintyChange: number
  /** The final volatility value after the change took place. */
  volatility: number
  /** The change that was applied to the volatility value for this game. */
  volatilityChange: number
  /** The final ranked points after this change took place. */
  points: number
  /** The change that was applied to the points for this game (including bonus points). */
  pointsChange: number
  /**
   * Whether this user's points have converged with their rating for this season. If points have not
   * converged (that is, they are lower than 4 * their division's base rating and have not surpassed
   * that value this season), they will receive extra points for wins (on top of the normal bonus
   * pool) to help them get to an appropriate point total more quickly.
   */
  pointsConverged: boolean
  /** The final amount of bonus points used this season after the change took place. */
  bonusUsed: number
  /** The change that was applied to the `bonusUsed` value for this game. */
  bonusUsedChange: number
  /**
   * The probability value (P) of this player winning the game. In the range [0, 1], with a value
   * of 0.5 meaning there is an equal probability of losing or winning.
   */
  probability: number
  /**
   * The number of games this user has played since the last season with an MMR reset. This can be
   * used to determine if they are still in placement matches or not.
   */
  lifetimeGames: number
}

type DbMatchmakingRatingChange = Dbify<MatchmakingRatingChange>

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
    uncertainty: result.uncertainty,
    uncertaintyChange: result.uncertainty_change,
    volatility: result.volatility,
    volatilityChange: result.volatility_change,
    points: result.points,
    pointsChange: result.points_change,
    pointsConverged: result.points_converged,
    bonusUsed: result.bonus_used,
    bonusUsedChange: result.bonus_used_change,
    probability: result.probability,
    lifetimeGames: result.lifetime_games,
  }
}

export async function insertMatchmakingRatingChange(
  client: DbClient,
  mmrChange: Readonly<MatchmakingRatingChange>,
): Promise<void> {
  const c = mmrChange

  await client.query(sql`
    INSERT INTO matchmaking_rating_changes
      (user_id, matchmaking_type, game_id, change_date, outcome, rating, rating_change,
        uncertainty, uncertainty_change, volatility, volatility_change,
        points, points_change, points_converged, bonus_used, bonus_used_change, probability,
        lifetime_games)
    VALUES
      (${c.userId}, ${c.matchmakingType}, ${c.gameId}, ${c.changeDate}, ${c.outcome}, ${c.rating},
        ${c.ratingChange}, ${c.uncertainty}, ${c.uncertaintyChange}, ${c.volatility},
        ${c.volatilityChange}, ${c.points}, ${c.pointsChange}, ${c.pointsConverged},
        ${c.bonusUsed}, ${c.bonusUsedChange}, ${c.probability}, ${c.lifetimeGames})
  `)
}

export async function getMatchmakingRatingChangesForGame(
  gameId: string,
  withClient?: DbClient,
): Promise<MatchmakingRatingChange[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingRatingChange>(sql`
      SELECT *
      FROM matchmaking_rating_changes
      WHERE game_id = ${gameId};
    `)

    return result.rows.map(r => fromDbMatchmakingRatingChange(r))
  } finally {
    done()
  }
}

type DbMatchmakingCompletion = Dbify<MatchmakingCompletion>

function fromDbMatchmakingCompletion(
  result: Readonly<DbMatchmakingCompletion>,
): MatchmakingCompletion {
  return {
    id: result.id,
    userId: result.user_id,
    matchmakingType: result.matchmaking_type,
    completionType: result.completion_type,
    searchTimeMillis: result.search_time_millis,
    completionTime: result.completion_time,
  }
}

export async function insertMatchmakingCompletion(
  completion: Omit<MatchmakingCompletion, 'id'>,
): Promise<MatchmakingCompletion> {
  const { userId, matchmakingType, completionType, searchTimeMillis, completionTime } = completion

  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingCompletion>(sql`
      INSERT INTO matchmaking_completions
        (user_id, matchmaking_type, completion_type, search_time_millis, completion_time)
      VALUES
        (${userId}, ${matchmakingType}, ${completionType}, ${searchTimeMillis}, ${completionTime})
      RETURNING *
    `)

    return fromDbMatchmakingCompletion(result.rows[0])
  } finally {
    done()
  }
}

type DbMatchmakingSeason = Dbify<MatchmakingSeason>

function fromDbMatchmakingSeason(result: Readonly<DbMatchmakingSeason>): MatchmakingSeason {
  return {
    id: result.id,
    startDate: result.start_date,
    name: result.name,
    resetMmr: result.reset_mmr,
  }
}

/** Returns all of the matchmaking seasons, in descending order by start date. */
export async function getMatchmakingSeasons(withClient?: DbClient): Promise<MatchmakingSeason[]> {
  const { client, done } = await db(withClient)

  try {
    const result = await client.query<DbMatchmakingSeason>(sql`
      SELECT *
      FROM matchmaking_seasons
      ORDER BY start_date DESC;
    `)
    return result.rows.map(r => fromDbMatchmakingSeason(r))
  } finally {
    done()
  }
}

export async function addMatchmakingSeason(
  season: Omit<MatchmakingSeason, 'id'>,
  withClient?: DbClient,
): Promise<MatchmakingSeason> {
  const { client, done } = await db(withClient)

  try {
    const result = await client.query<DbMatchmakingSeason>(sql`
      INSERT INTO matchmaking_seasons
        (start_date, name, reset_mmr)
      VALUES
        (${season.startDate}, ${season.name}, ${season.resetMmr})
      RETURNING *
    `)

    return fromDbMatchmakingSeason(result.rows[0])
  } finally {
    done()
  }
}

export async function deleteMatchmakingSeason(id: SeasonId, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)

  try {
    await client.query(sql`
      DELETE FROM matchmaking_seasons
      WHERE id = ${id};
    `)
  } finally {
    done()
  }
}
