import sql from 'sql-template-strings'
import { AssignedRaceChar, RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user'
import { UserStats } from '../../../common/users/user-stats'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'

type DbUserStats = Dbify<UserStats>

function convertFromDb(db: DbUserStats): UserStats {
  return {
    userId: db.user_id,

    pWins: db.p_wins,
    pLosses: db.p_losses,
    tWins: db.t_wins,
    tLosses: db.t_losses,
    zWins: db.z_wins,
    zLosses: db.z_losses,
    rWins: db.r_wins,
    rLosses: db.r_losses,

    rPWins: db.r_p_wins,
    rPLosses: db.r_p_losses,
    rTWins: db.r_t_wins,
    rTLosses: db.r_t_losses,
    rZWins: db.r_z_wins,
    rZLosses: db.r_z_losses,
  }
}

/**
 * Creates a new set of aggregated statistics for the specified user. Should generally only be used
 * when creating a new user account.
 */
export async function createUserStats(client: DbClient, userId: SbUserId): Promise<UserStats> {
  const result = await client.query<DbUserStats>(sql`
    INSERT INTO user_stats (user_id)
    VALUES (${userId})
    RETURNING *
  `)

  return convertFromDb(result.rows[0])
}

/**
 * Retrieves the aggregated statistics for a particular user.
 */
export async function getUserStats(userId: SbUserId): Promise<UserStats> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbUserStats>(sql`
      SELECT *
      FROM user_stats
      WHERE user_id = ${userId}
    `)
    if (!result.rows.length) {
      throw new Error('user not found')
    }

    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export type UserStatsCountKey = keyof Omit<DbUserStats, 'user_id'>

/**
 * Increments one of the aggregated statistics for a user. This should be used when game results
 * are reconciled, to keep the aggregate count up-to-date. For instance, if a user won a game as
 * Zerg, the `z_wins` column would be incremented.
 *
 * @returns the updated UserStats object
 * @see makeCountKeys for getting a `countKey` value safely
 */
export async function incrementUserStatsCount(
  client: DbClient,
  userId: SbUserId,
  countKey: UserStatsCountKey,
): Promise<UserStats> {
  const result = await client.query<DbUserStats>(
    sql`
      UPDATE user_stats
      SET `
      .append(countKey)
      .append(sql` = `)
      .append(countKey).append(sql` + 1
      WHERE user_id = ${userId}
      RETURNING *
      `),
  )

  if (!result.rows.length) {
    throw new Error('user not found')
  }

  return convertFromDb(result.rows[0])
}

/**
 * Returns the associated statistics key(s) for a particular selected and assigned race result. For
 * non-random selected races, this will always be an array with a single value. For random
 * selections, it will be an array with 2 values (the random wins/losses key, as well as the key for
 * the particular assigned race).
 */
export function makeCountKeys(
  selectedRace: RaceChar,
  assignedRace: AssignedRaceChar,
  result: 'win' | 'loss',
): UserStatsCountKey[] {
  const postfix = result === 'win' ? 'wins' : 'losses'

  const keys: UserStatsCountKey[] = [`${selectedRace}_${postfix}`]

  if (selectedRace === 'r') {
    keys.push(`r_${assignedRace}_${postfix}`)
  }

  return keys
}
