import { BugReport, compareAppVersionsNewestFirst } from '../../../common/bugs'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { escapeSearchString } from '../db/escape-search-string'
import { sql, sqlConcat, SqlTemplate } from '../db/sql'
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
    appVersion: row.app_version ?? undefined,
  }
}

export async function createBugReport(
  {
    submitterId,
    details,
    appVersion,
    createdAt,
  }: { submitterId?: SbUserId; details: string; appVersion?: string; createdAt: Date },
  withClient?: DbClient,
): Promise<BugReport> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbBugReport>(sql`
      INSERT INTO bug_reports (submitter_id, details, app_version, created_at)
      VALUES (${submitterId}, ${details}, ${appVersion}, ${createdAt})
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

/** The largest value `submitter_id` (an `integer`) can hold; longer digit strings can't match it. */
const MAX_USER_ID = 2 ** 31 - 1

export interface BugReportListFilters {
  includeResolved: boolean
  /**
   * Text matching a report if its ID, details or submitter's name contain it (case-insensitive), or
   * if it is all digits and equals the submitter's user ID. Leading/trailing whitespace is ignored,
   * and a blank search matches every report.
   */
  search?: string
  /** Only include reports filed from exactly this app version. */
  appVersion?: string
}

/** Returns the SQL conditions on `br` (bug_reports) and `u` (users) selecting `filters`. */
function bugReportFilterConditions({
  includeResolved,
  search,
  appVersion,
}: BugReportListFilters): SqlTemplate[] {
  const conditions = includeResolved ? [] : [sql`br.resolved_at IS NULL`]
  if (appVersion !== undefined) {
    conditions.push(sql`br.app_version = ${appVersion}`)
  }

  const trimmedSearch = search?.trim()
  if (trimmedSearch) {
    const pattern = `%${escapeSearchString(trimmedSearch)}%`
    const matches = [
      sql`br.id::text ILIKE ${pattern}`,
      sql`br.details ILIKE ${pattern}`,
      sql`u.name ILIKE ${pattern}`,
    ]
    if (/^\d+$/.test(trimmedSearch) && Number(trimmedSearch) <= MAX_USER_ID) {
      matches.push(sql`br.submitter_id = ${Number(trimmedSearch)}`)
    }
    conditions.push(sql`(${sqlConcat(' OR ', matches)})`)
  }

  return conditions
}

/**
 * Returns up to `limit` bug reports matching `filters`, newest first, ordered by `(created_at, id)`
 * so the order is total. If `before` is given, only reports that sort after that report are
 * returned; the comparison reads the stored row in SQL so paging stays exact at the column's full
 * timestamp precision. Returns `undefined` if the `before` report does not exist.
 */
export async function listBugReportsPage(
  {
    before,
    limit,
    ...filters
  }: BugReportListFilters & {
    before?: string
    limit: number
  },
  withClient?: DbClient,
): Promise<BugReport[] | undefined> {
  const { client, done } = await db(withClient)
  try {
    const conditions = bugReportFilterConditions(filters)
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
        (br.created_at, br.id) < (SELECT created_at, id FROM bug_reports WHERE id = ${before})
      `)
    }

    const result = await client.query<DbBugReport>(sql`
      SELECT br.*
      FROM bug_reports br
      LEFT JOIN users u ON u.id = br.submitter_id
      ${conditions.length ? sql`WHERE ${sqlConcat(' AND ', conditions)}` : sql``}
      ORDER BY br.created_at DESC, br.id DESC
      LIMIT ${limit}
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/** Returns every app version any bug report was filed from, newest first. */
export async function listBugReportAppVersions(withClient?: DbClient): Promise<string[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ app_version: string }>(sql`
      SELECT DISTINCT app_version
      FROM bug_reports
      WHERE app_version IS NOT NULL
    `)
    return result.rows.map(row => row.app_version).sort(compareAppVersionsNewestFirst)
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
