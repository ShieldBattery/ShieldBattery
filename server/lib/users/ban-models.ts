import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

export interface UserBanRow {
  id: string
  userId: SbUserId
  startTime: Date
  endTime: Date
  bannedBy?: SbUserId
  reason?: string
}

type DbUserBanRow = Dbify<UserBanRow>

export function toUserBanRow(dbRow: DbUserBanRow): UserBanRow {
  return {
    id: dbRow.id,
    userId: dbRow.user_id,
    startTime: dbRow.start_time,
    endTime: dbRow.end_time,
    bannedBy: dbRow.banned_by !== null ? dbRow.banned_by : undefined,
    reason: dbRow.reason ?? undefined,
  }
}

export async function retrieveBanHistory(
  userId: SbUserId,
  limit?: number,
  withClient?: DbClient,
): Promise<UserBanRow[]> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`
      SELECT id, user_id, start_time, end_time, banned_by, reason
      FROM user_bans
      WHERE user_id = ${userId}
      ORDER BY start_time DESC
    `
    if (limit !== undefined) {
      query = query.append(sql`
        LIMIT ${limit}
      `)
    }

    const result = await client.query<DbUserBanRow>(query)
    return result.rows.map(r => toUserBanRow(r))
  } finally {
    done()
  }
}

export async function banUsers(
  {
    users,
    bannedBy,
    endTime,
    reason,
  }: {
    users: ReadonlyArray<SbUserId>
    bannedBy?: SbUserId
    endTime: Date
    reason?: string
  },
  withClient?: DbClient,
): Promise<UserBanRow[]> {
  const { client, done } = await db(withClient)
  const startDate = new Date()
  const endDate = endTime

  try {
    const result = await client.query(sql`
      INSERT INTO user_bans (user_id, start_time, end_time, banned_by, reason)
      SELECT * FROM UNNEST(
        ${users}::int4[],
        ${new Array(users.length).fill(startDate)}::timestamp[],
        ${new Array(users.length).fill(endDate)}::timestamp[],
        ${new Array(users.length).fill(bannedBy ?? null)}::int4[],
        ${new Array(users.length).fill(reason ?? null)}::text[]
      ) AS t(user_id, start_time, end_time, banned_by, reason)
      RETURNING *
    `)

    return result.rows.map(r => toUserBanRow(r))
  } finally {
    done()
  }
}

export async function isUserBanned(userId: SbUserId, withClient?: DbClient): Promise<boolean> {
  const { client, done } = await db(withClient)

  try {
    const now = new Date()
    const result = await client.query(sql`
      SELECT 1 FROM user_bans
      WHERE user_id = ${userId}
        AND start_time <= ${now}
        AND end_time > ${now}
    `)
    return result.rows.length !== 0
  } finally {
    done()
  }
}
