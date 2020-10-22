import db, { DbClient } from '../db'
import sql from 'sql-template-strings'

// TODO(tec27): These game types should be in a more common place
export interface GameConfigPlayer {
  name: string
  race: 'p' | 'r' | 't' | 'z'
  isComputer: boolean
}

export interface GameConfig {
  gameType: number
  gameSubType: number
  teams: GameConfigPlayer[][]
}

export interface GameRecordData {
  startTime: Date
  mapId: string
  gameConfig: GameConfig
}

/**
 * Creates a new record in the `games` table using the specified client. This is intended to be used
 * inside a transaction while also creating records for each user's game results.
 */
export async function createGameRecord(
  client: DbClient,
  { startTime, mapId, gameConfig }: GameRecordData,
) {
  // TODO(tec27): We could make some type of TransactionClient transformation to enforce this is
  // done in a transaction
  const result = await client.query(sql`
    INSERT INTO games (
      id, start_time, map_id, config, disputable, dispute_requested, dispute_reviewed, game_length
    ) VALUES (
      uuid_generate_v4(), ${startTime}, ${mapId}, ${gameConfig}, FALSE, FALSE, FALSE, NULL
    ) RETURNING id
  `)

  return result.rows[0].id
}

/**
 * Deletes a record from the `games` table. This should likely be accompanied by deleting the
 * user-specific result rows in `games_users`.
 */
export async function deleteRecordForGame(gameId: string) {
  const { client, done } = await db()
  try {
    await client.query(sql`DELETE FROM games WHERE id = ${gameId}`)
  } finally {
    done()
  }
}
