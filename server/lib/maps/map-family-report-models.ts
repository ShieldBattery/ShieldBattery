import db, { DbClient } from '../db'
import { sql } from '../db/sql'

/**
 * Returns when each open map family report filed since `since` was filed, newest first, at most
 * `limit` of them. Backs the open-report count shown to staff.
 */
export async function listRecentOpenMapFamilyReportTimes(
  { since, limit }: { since: Date; limit: number },
  withClient?: DbClient,
): Promise<Date[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ reported_at: Date }>(sql`
      SELECT reported_at
      FROM map_family_reports
      WHERE status = 'open' AND reported_at >= ${since}
      ORDER BY reported_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(row => row.reported_at)
  } finally {
    done()
  }
}
