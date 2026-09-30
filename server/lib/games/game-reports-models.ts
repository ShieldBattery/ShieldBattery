import db, { DbClient } from '../db'
import { sql } from '../db/sql'

/**
 * Returns the creation times of unresolved game reports created at or after `since`, newest first.
 * The `game_reports` table is owned by server-rs; this is a read-only query for the admin report
 * counts, which Node pushes to admins.
 */
export async function listRecentUnresolvedGameReportTimes(
  { since, limit }: { since: Date; limit: number },
  withClient?: DbClient,
): Promise<Date[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ created_at: Date }>(sql`
      SELECT created_at
      FROM game_reports
      WHERE resolved_at IS NULL AND created_at >= ${since}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(row => row.created_at)
  } finally {
    done()
  }
}
