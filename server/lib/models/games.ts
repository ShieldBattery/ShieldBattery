import sql from 'sql-template-strings'
import db, { DbClient } from '../db'
import { GameConfig, GameConfigPlayerId } from '../games/configuration'
import { ReconciledPlayerResult, ReconciledResults } from '../games/results'

export interface DbGame {
  id: string
  startTime: Date
  mapId: string
  config: GameConfig<GameConfigPlayerId>
  disputable: boolean
  disputeRequested: boolean
  disputeReviewed: boolean
  gameLength: number | null
  results: [number, ReconciledPlayerResult][] | null
}

export type CreateGameRecordData = Pick<DbGame, 'startTime' | 'mapId' | 'config'>

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
  const result = await client.query(sql`
    INSERT INTO games (
      id, start_time, map_id, config, disputable, dispute_requested, dispute_reviewed, game_length
    ) VALUES (
      uuid_generate_v4(), ${startTime}, ${mapId}, ${config}, FALSE, FALSE, FALSE, NULL
    ) RETURNING id
  `)

  return result.rows[0].id
}

/**
 * Returns a `DbGame` for the specificied ID, or null if one could not be found.
 */
export async function getGameRecord(gameId: string): Promise<DbGame | null> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      SELECT id, start_time, map_id, config, disputable, dispute_requested, dispute_reviewed,
        game_length, results
      FROM games
      WHERE id = ${gameId}`)
    if (!result.rowCount) {
      return null
    } else {
      const row = result.rows[0]
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
) {
  return client.query(sql`
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
