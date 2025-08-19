import { BugReport } from '../../../common/bugs'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
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
  client: DbClient,
  { submitterId, details, createdAt }: { submitterId?: SbUserId; details: string; createdAt: Date },
): Promise<BugReport> {
  const result = await client.query<DbBugReport>(sql`
    INSERT INTO bug_reports (submitter_id, details, created_at)
    VALUES (${submitterId}, ${details}, ${createdAt})
    RETURNING *
  `)
  return convertFromDb(result.rows[0])
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
