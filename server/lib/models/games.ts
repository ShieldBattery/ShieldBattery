import db, { DbClient } from '../db'
import sql from 'sql-template-strings'
import { GameConfig, GameConfigPlayerId } from '../games/configuration'

export interface DbGame {
  id: string
  startTime: Date
  mapId: string
  config: GameConfig<GameConfigPlayerId>
  disputable: boolean
  disputeRequested: boolean
  disputeReviewed: boolean
  gameLength: number | null
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
        game_length
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
