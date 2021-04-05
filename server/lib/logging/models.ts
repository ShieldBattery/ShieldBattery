import sql from 'sql-template-strings'
import { LogEntry } from '../../../common/admin/server-logs'
import db from '../db'

/**
 * Retrieves the last `limit` log entries from the server logs, ordered by date. Can be optionally
 * filtered by start or end date, or by a specific request ID.
 */
export async function retrieveLogEntries({
  limit,
  startDate,
  endDate,
  reqId,
  level,
}: {
  limit: number
  startDate?: Date
  endDate?: Date
  reqId?: string
}): Promise<LogEntry[]> {
  const { client, done } = await db()
  try {
    const query = sql`SELECT id, time, data FROM server_logs `

    // TODO(tec27): Write something to do multiple optional conditions like this nicely
    let hasWhere = false
    if (startDate !== undefined) {
      query.append(sql`WHERE time > ${startDate} `)
      hasWhere = true
    }
    if (endDate !== undefined) {
      if (!hasWhere) {
        query.append(sql`WHERE time < ${endDate} `)
        hasWhere = true
      } else {
        query.append(sql`AND time < ${endDate} `)
      }
    }
    if (reqId !== undefined) {
      if (!hasWhere) {
        query.append(sql`WHERE data->'req'->>'id' = ${reqId} `)
        hasWhere = true
      } else {
        query.append(sql`AND data->'req'->>'id' = ${reqId} `)
      }
    }
    if (level !== undefined) {
      if (!hasWhere) {
        query.append(sql`WHERE (data->>'level')::int = ${level} `)
        hasWhere = true
      } else {
        query.append(sql`AND (data->>'level')::int = ${level} `)
      }
    }

    query.append(sql`ORDER BY time DESC LIMIT ${limit};`)

    const result = await client.query<LogEntry>(query)
    return result.rows
  } finally {
    done()
  }
}
