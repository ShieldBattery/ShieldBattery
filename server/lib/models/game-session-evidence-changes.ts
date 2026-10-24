import { withDbClient } from '../db'
import { sql } from '../db/sql'

/** Deletes one bounded batch without waiting on observations being updated by an ingestion. */
export async function deleteExpiredGameSessionEvidenceChanges(before: Date): Promise<void> {
  await withDbClient(client =>
    client.query(sql`
      WITH expired AS (
        SELECT id FROM game_session_evidence_changes
        WHERE changed_at < ${before}
        ORDER BY changed_at, id
        LIMIT 1000
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM game_session_evidence_changes
      USING expired
      WHERE game_session_evidence_changes.id = expired.id
    `),
  )
}
