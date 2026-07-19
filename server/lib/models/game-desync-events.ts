import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/**
 * Records a relay-observed desync event for a game, keyed by (gameId, syncOrdinal) — the same sync
 * ordinal reported twice by a retried/redundant webhook delivery is a no-op, so at-least-once
 * delivery from the coordinator is safe to ingest unconditionally.
 *
 * This slice only records the event; reconciliation (majority-authoritative resolution / voiding /
 * lobby-dispute) is a later slice that reads this table.
 *
 * @returns whether a row was actually inserted (false means this was a duplicate).
 */
export async function recordDesyncEvent({
  gameId,
  syncOrdinal,
  detectedAt,
  gameFrame,
  noMajority,
  divergedUserIds,
}: {
  gameId: string
  syncOrdinal: number
  detectedAt: Date
  gameFrame?: number
  noMajority: boolean
  divergedUserIds: SbUserId[]
}): Promise<boolean> {
  const { client, done } = await db()

  try {
    const result = await client.query(sql`
      INSERT INTO game_desync_events
        (game_id, sync_ordinal, detected_at, game_frame, no_majority, diverged_user_ids)
      VALUES
        (${gameId}, ${syncOrdinal}, ${detectedAt}, ${gameFrame ?? null}, ${noMajority}, ${divergedUserIds})
      ON CONFLICT (game_id, sync_ordinal) DO NOTHING
    `)

    return !!result.rowCount
  } finally {
    done()
  }
}

/** A relay-observed desync event recorded for a game. */
export interface GameDesyncEvent {
  gameId: string
  syncOrdinal: number
  detectedAt: Date
  gameFrame: number | null
  noMajority: boolean
  /** The resolved user IDs the relay identified as diverging; empty exactly when `noMajority`. */
  divergedUserIds: SbUserId[]
}

type DbGameDesyncEvent = Dbify<GameDesyncEvent>

/**
 * Retrieves all recorded desync events for a game, ordered by sync ordinal (ascending).
 */
export async function getDesyncEventsForGame(gameId: string): Promise<GameDesyncEvent[]> {
  const { client, done } = await db()

  try {
    const result = await client.query<DbGameDesyncEvent>(sql`
      SELECT game_id, sync_ordinal, detected_at, game_frame, no_majority, diverged_user_ids
      FROM game_desync_events
      WHERE game_id = ${gameId}
      ORDER BY sync_ordinal
    `)

    return result.rows.map(row => ({
      gameId: row.game_id,
      // sync_ordinal is a BIGINT, so pg returns it as a string; normalize to a number.
      syncOrdinal: Number(row.sync_ordinal),
      detectedAt: row.detected_at,
      gameFrame: row.game_frame,
      noMajority: row.no_majority,
      divergedUserIds: row.diverged_user_ids,
    }))
  } finally {
    done()
  }
}
