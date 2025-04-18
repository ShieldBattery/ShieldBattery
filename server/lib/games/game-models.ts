import { GameRecord, GameRouteDebugInfo } from '../../../common/games/games'
import { ReconciledResults } from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

type DbGameRecord = Dbify<GameRecord>

export type CreateGameRecordData = Pick<GameRecord, 'startTime' | 'mapId' | 'config'>

function convertFromDb(row: DbGameRecord): GameRecord {
  return {
    id: row.id,
    startTime: row.start_time,
    mapId: row.map_id,
    config: row.config,
    disputable: row.disputable,
    disputeRequested: row.dispute_requested,
    disputeReviewed: row.dispute_reviewed,
    gameLength: row.game_length,
    results: row.results,
  }
}

/**
 * Creates a new record in the `games` table using the specified client. This is intended to be used
 * inside a transaction while also creating records for each user's game results.
 */
export async function createGameRecord(
  client: DbClient,
  { startTime, mapId, config }: CreateGameRecordData,
): Promise<string> {
  // TODO(tec27): We could make some type of TransactionClient transformation to enforce this is
  // done in a transaction
  const result = await client.query<{ id: string }>(sql`
    INSERT INTO games (
      start_time, map_id, config, disputable, dispute_requested, dispute_reviewed, game_length
    ) VALUES (
      ${startTime}, ${mapId}, ${config}, FALSE, FALSE, FALSE, NULL
    ) RETURNING id
  `)

  return result.rows[0].id
}

/**
 * Returns a `GameRecord` for the specificied ID, or `undefined` if one could not be found.
 */
export async function getGameRecord(gameId: string): Promise<GameRecord | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbGameRecord>(sql`
      SELECT id, start_time, map_id, config, disputable, dispute_requested, dispute_reviewed,
        game_length, results
      FROM games
      WHERE id = ${gameId}`)
    return result.rowCount ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Deletes a record from the `games` table. This should likely be accompanied by deleting the
 * user-specific result rows in `games_users`.
 */
export async function deleteRecordForGame(gameId: string): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`DELETE FROM games WHERE id = ${gameId}`)
  } finally {
    done()
  }
}

/**
 * Sets the reconciled (and probably final) result for a particular game. This is intended
 * to be executed in a transaction that updates all the users and the full game results at once.
 */
export async function setReconciledResult(
  client: DbClient,
  gameId: string,
  results: ReconciledResults,
): Promise<void> {
  await client.query(sql`
    UPDATE games
    SET
      results = ${JSON.stringify(Array.from(results.results.entries()))},
      game_length = ${results.time},
      disputable = ${results.disputed},
      dispute_requested = false,
      dispute_reviewed = false
    WHERE id = ${gameId}
  `)
}

/**
 * Updates the route debug info for the specified game. This should be used when the game is in the
 * process of loading, and all players have had their rally-point routes determined and created.
 */
export async function updateRouteDebugInfo(
  gameId: string,
  routeDebugInfo: GameRouteDebugInfo[],
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE games
      SET routes = ${routeDebugInfo}
      WHERE id = ${gameId}
    `)
  } finally {
    done()
  }
}

/**
 * Returns the number of games that have been completed (that is, have non-null results).
 */
export async function countCompletedGames(): Promise<number> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ count: string }>(
      sql`SELECT COUNT(*) as count FROM games WHERE results IS NOT NULL;`,
    )
    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

/**
 * Retrieves game information for the last `numGames` games of a user. The resulting array may be
 * empty or less than `numGames` in length if the user has not played that many games. This list
 * will also include games that have incomplete results or are disputed.
 */
export async function getRecentGamesForUser(
  userId: SbUserId,
  numGames: number,
): Promise<GameRecord[]> {
  // TODO(tec27): Support pagination on this

  const { client, done } = await db()
  try {
    const result = await client.query<DbGameRecord>(sql`
      SELECT g.*
      FROM games_users u JOIN games g ON u.game_id = g.id
      WHERE u.user_id = ${userId}
      ORDER BY u.start_time DESC
      LIMIT ${numGames}
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Retrieves game information for the match history of a user.
 */
export async function searchGamesForUser(
  {
    userId,
    limit,
    offset,
  }: {
    userId: SbUserId
    limit: number
    offset: number
  },
  withClient?: DbClient,
): Promise<GameRecord[]> {
  const { client, done } = await db(withClient)
  try {
    const query = sql`
      SELECT *
      FROM games_users gu
      INNER JOIN games g ON gu.game_id = g.id
      WHERE gu.user_id = ${userId}
      ORDER BY g.start_time DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `

    const result = await client.query<DbGameRecord>(query)

    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Returns a list of game IDs that don't yet have reconciled results. This can be used to (roughly)
 * determine games that have completed but didn't get reconciled (usually because at least one
 * player failed to report).
 *
 * @param reportedBeforeTime Only include game IDs that have a reported result from before this time
 * @param withClient a DB client to use to make the query (optional)
 */
export async function findUnreconciledGames(
  reportedBeforeTime: Date,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      SELECT DISTINCT gu.game_id as "id"
      FROM games_users gu
      WHERE gu."reported_results" IS NOT NULL
      AND gu."result" IS NULL
      AND gu.reported_at < ${reportedBeforeTime};
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}
