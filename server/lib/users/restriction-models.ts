import { RestrictionKind, RestrictionReason } from '../../../common/users/restrictions'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { ClientIdentifierBuffer } from './client-ids'

export interface UserIdentifierRestriction {
  id: string
  identifierType: number
  identifierHash: Buffer
  kind: RestrictionKind
  startTime: Date
  endTime: Date
  restrictedBy?: SbUserId
  firstUserId?: SbUserId
  reason: RestrictionReason
  adminNotes?: string
}

type DbUserIdentifierRestriction = Dbify<UserIdentifierRestriction>

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function toUserIdentifierRestriction(
  fromDb: DbUserIdentifierRestriction,
): UserIdentifierRestriction {
  return {
    id: fromDb.id,
    identifierType: fromDb.identifier_type,
    identifierHash: fromDb.identifier_hash,
    kind: fromDb.kind,
    startTime: fromDb.start_time,
    endTime: fromDb.end_time,
    restrictedBy: fromDb.restricted_by ?? undefined,
    firstUserId: fromDb.first_user_id ?? undefined,
    reason: fromDb.reason,
    adminNotes: fromDb.admin_notes ?? undefined,
  }
}

export interface UserRestriction {
  id: string
  userId: SbUserId
  kind: RestrictionKind
  startTime: Date
  endTime: Date
  restrictedBy?: SbUserId
  reason: RestrictionReason
  adminNotes?: string
}

type DbUserRestriction = Dbify<UserRestriction>

function toUserRestriction(fromDb: DbUserRestriction): UserRestriction {
  return {
    id: fromDb.id,
    userId: fromDb.user_id,
    kind: fromDb.kind,
    startTime: fromDb.start_time,
    endTime: fromDb.end_time,
    restrictedBy: fromDb.restricted_by ?? undefined,
    reason: fromDb.reason,
    adminNotes: fromDb.admin_notes ?? undefined,
  }
}

export interface RestrictedIdentifierCountResult {
  count: number
  latestEnd: Date
  reason: RestrictionReason
  restrictedBy?: SbUserId
  firstUserId?: SbUserId
}

export async function countRestrictedUserIdentifiers(
  { userId, kind }: { userId: SbUserId; kind: RestrictionKind },
  withClient?: DbClient,
): Promise<RestrictedIdentifierCountResult | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{
      matches: string
      latest_end: Date
      reason: RestrictionReason
      restricted_by: SbUserId | null
      first_user_id: SbUserId
    }>(sql`
      WITH restrictions AS (
      SELECT id, identifier_type, identifier_hash, end_time, reason, restricted_by, first_user_id
      FROM user_identifier_restrictions uir
      WHERE
          uir.kind = ${kind} AND
          (uir.identifier_type, uir.identifier_hash) IN (
            SELECT identifier_type, identifier_hash
            FROM user_identifiers ui
            WHERE ui.user_id = ${userId}
            AND identifier_type != 0
          ) AND
          uir.end_time > NOW()
        ORDER BY end_time DESC
      ),

      distinct_types AS (
        SELECT DISTINCT ON (identifier_type) id, identifier_type
        FROM restrictions
      )

      SELECT COUNT(*) OVER () as "matches",
        r.identifier_type, r.end_time as "latest_end", r.reason, r.restricted_by, r.first_user_id
      FROM distinct_types dt
      JOIN restrictions r
      ON dt.id = r.id
      ORDER BY r.end_time DESC
      LIMIT 1
    `)

    return result.rows.length > 0
      ? {
          count: Number(result.rows[0].matches),
          latestEnd: result.rows[0].latest_end,
          reason: result.rows[0].reason,
          restrictedBy: result.rows[0].restricted_by ?? undefined,
          firstUserId: result.rows[0].first_user_id,
        }
      : undefined
  } finally {
    done()
  }
}

export async function restrictUsers(
  {
    users,
    kind,
    startTime,
    endTime,
    restrictedBy,
    reason,
    adminNotes,
  }: {
    users: ReadonlyArray<SbUserId>
    kind: RestrictionKind
    startTime: Date
    endTime: Date
    restrictedBy?: SbUserId
    reason: RestrictionReason
    adminNotes?: string
  },
  withClient?: DbClient,
): Promise<UserRestriction[]> {
  const { client, done } = await db(withClient)
  if (startTime >= endTime) {
    throw new Error('Start time must be before end time')
  } else if (endTime < new Date()) {
    throw new Error('End time must be in the future')
  }

  try {
    const result = await client.query(sql`
      INSERT INTO user_restrictions
        (user_id, kind, start_time, end_time, restricted_by, reason, admin_notes)
      SELECT * FROM UNNEST(
        ${users}::int4[],
        ${new Array(users.length).fill(kind)}::restriction_kind[],
        ${new Array(users.length).fill(startTime)}::timestamptz[],
        ${new Array(users.length).fill(endTime)}::timestamptz[],
        ${new Array(users.length).fill(restrictedBy)}::int4[],
        ${new Array(users.length).fill(reason)}::restriction_reason[],
        ${new Array(users.length).fill(adminNotes)}::text[]
      ) AS t(user_id, kind, start_time, end_time, restricted_by, reason, admin_notes)
      RETURNING *
    `)

    return result.rows.map(r => toUserRestriction(r))
  } finally {
    done()
  }
}

// NOTE(tec27): The identifier restrictrions are basically just the latest restriction, rather than
// trying to be a log of when restrictions occurred (if you want that, you can use the user table).
// We do try to combine admin notes, though. Since we know these are all starting in the past, we
// move the start time to the latest one as well.
const ON_IDENTIFIER_CONFLICT = sql`
  ON CONFLICT (identifier_type, identifier_hash, kind)
  DO UPDATE SET
    start_time = GREATEST(uir.start_time, EXCLUDED.start_time),
    end_time = GREATEST(uir.end_time, EXCLUDED.end_time),
    reason = EXCLUDED.reason,
    restricted_by = EXCLUDED.restricted_by,
    admin_notes = CASE
      WHEN EXCLUDED.admin_notes IS NOT NULL AND uir.admin_notes IS NOT NULL THEN
        EXCLUDED.admin_notes || '\n---\n' || uir.admin_notes
      ELSE COALESCE(uir.admin_notes, EXCLUDED.admin_notes)
    END
`

export async function restrictAllIdentifiers(
  {
    originalTarget,
    users,
    kind,
    startTime,
    endTime,
    restrictedBy,
    reason,
    adminNotes,
  }: {
    originalTarget?: SbUserId
    users: ReadonlyArray<SbUserId>
    kind: RestrictionKind
    startTime: Date
    endTime: Date
    restrictedBy?: SbUserId
    reason: RestrictionReason
    adminNotes?: string
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)

  try {
    await client.query(sql`
      INSERT INTO user_identifier_restrictions AS uir (
        identifier_type, identifier_hash, kind, start_time, end_time, restricted_by, reason,
        first_user_id, admin_notes
      )
      SELECT DISTINCT ON (identifier_type, identifier_hash)
        identifier_type,
        identifier_hash,
        ${kind} AS "kind",
        ${startTime} AS "start_time",
        ${endTime} AS "end_time",
        ${restrictedBy} AS "restricted_by",
        ${reason} AS "reason",
        ${originalTarget} AS "first_user_id",
        ${adminNotes} AS "admin_notes"
      FROM user_identifiers
      WHERE user_id = ANY(${users}) AND identifier_type != 0
      ${ON_IDENTIFIER_CONFLICT}
    `)
  } finally {
    done()
  }
}

/**
 * Copies existing `UserRestriction`s to specific identifiers. Useful if a user is restricted and
 * registers a new identifier afterwards.
 */
export async function mirrorRestrictionsToIdentifiers({
  restrictions,
  identifiers,
}: {
  restrictions: ReadonlyArray<UserRestriction>
  identifiers: ReadonlyArray<ClientIdentifierBuffer>
}): Promise<void> {
  if (restrictions.length === 0 || identifiers.length === 0) {
    return
  }

  await transact(async client => {
    for (const r of restrictions) {
      await client.query(sql`
        INSERT INTO user_identifier_restrictions AS uir (
          identifier_type, identifier_hash, kind, start_time, end_time, restricted_by, reason,
          first_user_id, admin_notes
        )
        SELECT * FROM UNNEST(
          ${identifiers.map(i => i[0])}::int2[],
          ${identifiers.map(i => i[1])}::bytea[],
          ${new Array(identifiers.length).fill(r.kind)}::restriction_kind[],
          ${new Array(identifiers.length).fill(r.startTime)}::timestamptz[],
          ${new Array(identifiers.length).fill(r.endTime)}::timestamptz[],
          ${new Array(identifiers.length).fill(r.restrictedBy)}::int4[],
          ${new Array(identifiers.length).fill(r.reason)}::restriction_reason[],
          ${new Array(identifiers.length).fill(r.userId)}::int4[],
          ${new Array(identifiers.length).fill(r.adminNotes)}::text[]
        )
        ${ON_IDENTIFIER_CONFLICT}
      `)
    }
  })
}

/**
 * Returns the active restrictions for a users (based only on the `user_restrictions` table, this
 * expects that any relevant identifier restrictions have already been previously applied). This
 * will return the last-expiring restriction for each kind.
 */
export async function getActiveUserRestrictions(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<UserRestriction[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUserRestriction>(sql`
      SELECT DISTINCT ON (kind) *
      FROM user_restrictions
      WHERE user_id = ${userId} AND
        end_time > NOW() AND
        start_time <= NOW()
      ORDER BY kind, end_time DESC
    `)

    return result.rows.map(r => toUserRestriction(r))
  } finally {
    done()
  }
}

export async function checkRestriction(
  { userId, kind }: { userId: SbUserId; kind: RestrictionKind },
  withClient?: DbClient,
): Promise<boolean> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      SELECT 1
      FROM user_restrictions
      WHERE user_id = ${userId} AND
        kind = ${kind} AND
        end_time > NOW() AND
        start_time <= NOW()
      LIMIT 1
    `)

    return result.rows.length > 0
  } finally {
    done()
  }
}

/** Returns an array of the subset of user IDs that are currently restricted. */
export async function checkMultipleRestrictions({
  users,
  kind,
}: {
  users: ReadonlyArray<SbUserId>
  kind: RestrictionKind
}): Promise<SbUserId[]> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ user_id: SbUserId }>(sql`
      SELECT DISTINCT user_id
      FROM user_restrictions
      WHERE user_id = ANY(${users}) AND
        kind = ${kind} AND
        end_time > NOW() AND
        start_time <= NOW()
    `)
    return result.rows.map(r => r.user_id)
  } finally {
    done()
  }
}

export async function retrieveRestrictionHistory(
  { userId, limit }: { userId: SbUserId; limit?: number },
  withClient?: DbClient,
): Promise<UserRestriction[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbUserRestriction>(sql`
      SELECT *
      FROM user_restrictions
      WHERE user_id = ${userId}
      ORDER BY start_time DESC
      ${limit !== undefined ? sql`LIMIT ${limit}` : sql``}
    `)

    return result.rows.map(r => toUserRestriction(r))
  } finally {
    done()
  }
}

export async function cleanupOldRestrictedIdentifiers(
  olderThan: Date,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      DELETE FROM user_identifier_restrictions
      WHERE end_time < ${olderThan}
    `)

    return result.rowCount ?? 0
  } finally {
    done()
  }
}
