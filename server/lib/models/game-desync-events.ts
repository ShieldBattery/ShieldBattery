import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql } from '../db/sql'

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
