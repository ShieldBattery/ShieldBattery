import sql from 'sql-template-strings'
import db from '../db'

// TODO(tec27): Once Datadog integration has been deployed for 60 days, drop the old table and
// remove this code
/**
 * Deletes logs older than 60 days. This should be run periodically to keep the table small and
 * remove potentially sensitive data.
 */
export async function deleteOldLogs(): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`DELETE FROM server_logs WHERE time < NOW() - INTERVAL '60 days';`)
  } finally {
    done()
  }
}
