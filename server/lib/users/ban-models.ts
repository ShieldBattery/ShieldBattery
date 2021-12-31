import sql from 'sql-template-strings'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
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

export function toUserBanRow(dbRow: DbUserBanRow) {
  return {
    id: dbRow.id,
    userId: dbRow.user_id,
    startTime: dbRow.start_time,
    endTime: dbRow.end_time,
    bannedBy: dbRow.banned_by !== null ? dbRow.banned_by : undefined,
    reason: dbRow.reason,
  }
}

export async function retrieveBanHistory(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<UserBanRow[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      SELECT id, user_id, start_time, end_time, banned_by, reason
      FROM user_bans
      WHERE user_id = ${userId}
      ORDER BY start_time DESC
    `)

    return result.rows.map(r => toUserBanRow(r))
  } finally {
    done()
  }
}

export async function banUser(
  {
    userId,
    bannedBy,
    banLengthHours,
    reason,
  }: { userId: SbUserId; bannedBy?: SbUserId; banLengthHours: number; reason?: string },
  withClient?: DbClient,
): Promise<UserBanRow> {
  const { client, done } = await db(withClient)
  const startDate = new Date()
  const endDate = new Date()
  endDate.setHours(endDate.getHours() + banLengthHours)

  try {
    const result = await client.query(sql`
      INSERT INTO user_bans (user_id, start_time, end_time, banned_by, reason)
      VALUES (${userId}, ${startDate}, ${endDate}, ${bannedBy}, ${reason})
      RETURNING *
    `)

    return toUserBanRow(result.rows[0])
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
