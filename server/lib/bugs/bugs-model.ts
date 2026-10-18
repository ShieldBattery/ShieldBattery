import { BugReport } from '../../../common/bugs'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql, sqlConcat } from '../db/sql'
import { Dbify } from '../db/types'

type DbBugReport = Dbify<BugReport>

function convertFromDb(row: DbBugReport): BugReport {
  return {
    id: row.id,
    submitterId: row.submitter_id ?? undefined,
    details: row.details,
    logsDeleted: row.logs_deleted,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at ?? undefined,
    resolverId: row.resolver_id ?? undefined,
  }
}

export async function createBugReport(
  { submitterId, details, createdAt }: { submitterId?: SbUserId; details: string; createdAt: Date },
  withClient?: DbClient,
): Promise<BugReport> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbBugReport>(sql`
      INSERT INTO bug_reports (submitter_id, details, created_at)
      VALUES (${submitterId}, ${details}, ${createdAt})
      RETURNING *
    `)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function deleteBugReport(reportId: string, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM bug_reports
      WHERE id = ${reportId}
    `)
  } finally {
    done()
  }
}

export async function listBugReports(
  includeResolved = false,
  withClient?: DbClient,
): Promise<BugReport[]> {
  const query = sql`
    SELECT *
    FROM bug_reports
    ${includeResolved ? sql`` : sql`WHERE resolved_at IS NULL`}
    ORDER BY created_at DESC
  `

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbBugReport>(query)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Returns up to `limit` bug reports, newest first, ordered by `(created_at, id)` so the order is
 * total. If `before` is given, only reports that sort after that report are returned; the
 * comparison reads the stored row in SQL so paging stays exact at the column's full timestamp
 * precision. Returns `undefined` if the `before` report does not exist.
 */
export async function listBugReportsPage(
  { includeResolved, before, limit }: { includeResolved: boolean; before?: string; limit: number },
  withClient?: DbClient,
): Promise<BugReport[] | undefined> {
  const { client, done } = await db(withClient)
  try {
    const conditions = includeResolved ? [] : [sql`resolved_at IS NULL`]
    if (before) {
      const cursor = await client.query(sql`
        SELECT 1
        FROM bug_reports
        WHERE id = ${before}
      `)
      if (!cursor.rowCount) {
        return undefined
      }
      conditions.push(sql`
        (created_at, id) < (SELECT created_at, id FROM bug_reports WHERE id = ${before})
      `)
    }

    const result = await client.query<DbBugReport>(sql`
      SELECT *
      FROM bug_reports
      ${conditions.length ? sql`WHERE ${sqlConcat(' AND ', conditions)}` : sql``}
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Returns the creation times of unresolved bug reports created at or after `since`, newest first.
 */
export async function listRecentUnresolvedBugReportTimes(
  { since, limit }: { since: Date; limit: number },
  withClient?: DbClient,
): Promise<Date[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ created_at: Date }>(sql`
      SELECT created_at
      FROM bug_reports
      WHERE resolved_at IS NULL AND created_at >= ${since}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `)
    return result.rows.map(row => row.created_at)
  } finally {
    done()
  }
}

export async function getBugReport(
  reportId: string,
  withClient?: DbClient,
): Promise<BugReport | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbBugReport>(sql`
      SELECT *
      FROM bug_reports
      WHERE id = ${reportId}
    `)
    return result.rowCount ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function resolveBugReport(
  {
    reportId,
    resolvedAt,
    resolverId,
  }: { reportId: string; resolvedAt: Date; resolverId: SbUserId },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE bug_reports
      SET
        resolved_at = ${resolvedAt},
        resolver_id = ${resolverId}
      WHERE id = ${reportId}
    `)
  } finally {
    done()
  }
}

export async function findDeletableBugReports(
  olderThan: Date,
  withClient?: DbClient,
): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ id: string }>(sql`
      SELECT id
      FROM bug_reports
      WHERE created_at < ${olderThan}
        AND logs_deleted = false
    `)
    return result.rows.map(row => row.id)
  } finally {
    done()
  }
}

export async function markBugReportFilesDeleted(
  reportId: string,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      UPDATE bug_reports
      SET logs_deleted = true
      WHERE id = ${reportId}
    `)
  } finally {
    done()
  }
}
