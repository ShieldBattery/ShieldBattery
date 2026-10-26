import { SbUserId } from '../../../common/users/sb-user-id'
import { BanSource } from '../../../common/users/user-network'
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
  source: BanSource
  /** The target of the ban that caused this one, when this account was banned as a linked one. */
  cascadedFrom?: SbUserId
  gameId?: string
  unbannedBy?: SbUserId
  unbannedAt?: Date
  unbanReason?: string
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
    source: dbRow.source,
    cascadedFrom: dbRow.cascaded_from ?? undefined,
    gameId: dbRow.game_id ?? undefined,
    unbannedBy: dbRow.unbanned_by !== null ? dbRow.unbanned_by : undefined,
    unbannedAt: dbRow.unbanned_at ?? undefined,
    unbanReason: dbRow.unban_reason ?? undefined,
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
      SELECT id, user_id, start_time, end_time, banned_by, reason, source, cascaded_from, game_id,
        unbanned_by, unbanned_at, unban_reason
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

/**
 * Bans `users` together for the same cause. Every user other than `target` is recorded as banned
 * because of its link to `target`.
 */
export async function banUsers(
  {
    users,
    target,
    bannedBy,
    endTime,
    reason,
    source,
    gameId,
  }: {
    users: ReadonlyArray<SbUserId>
    target: SbUserId
    bannedBy?: SbUserId
    endTime: Date
    reason?: string
    source: BanSource
    gameId?: string
  },
  withClient?: DbClient,
): Promise<UserBanRow[]> {
  const { client, done } = await db(withClient)
  const startDate = new Date()
  const endDate = endTime

  try {
    const result = await client.query(sql`
      INSERT INTO user_bans
        (user_id, start_time, end_time, banned_by, reason, source, cascaded_from, game_id)
      SELECT t.*, ${source}, NULLIF(${target}::int4, t.user_id), ${gameId ?? null}::uuid
      FROM UNNEST(
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

/**
 * Ends every currently active ban for the given users at `now`, recording who lifted them and why.
 * Returns the bans that were lifted.
 */
export async function liftUserBans(
  {
    users,
    unbannedBy,
    reason,
    now = new Date(),
  }: {
    users: ReadonlyArray<SbUserId>
    unbannedBy?: SbUserId
    reason?: string
    now?: Date
  },
  withClient?: DbClient,
): Promise<UserBanRow[]> {
  const { client, done } = await db(withClient)

  try {
    const result = await client.query<DbUserBanRow>(sql`
      UPDATE user_bans
      SET end_time = ${now}, unbanned_by = ${unbannedBy ?? null}, unbanned_at = ${now},
          unban_reason = ${reason ?? null}
      WHERE user_id = ANY(${users}) AND end_time > ${now}
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

/** Returns an active ban to reuse when a durable request targets an already banned account. */
export async function getActiveUserBan(
  userId: SbUserId,
  client: DbClient,
): Promise<UserBanRow | undefined> {
  const now = new Date()
  const result = await client.query<DbUserBanRow>(sql`
    SELECT * FROM user_bans WHERE user_id = ${userId}
      AND start_time <= ${now} AND end_time > ${now} AND unbanned_at IS NULL
    ORDER BY end_time DESC LIMIT 1
  `)
  return result.rows.length ? toUserBanRow(result.rows[0]) : undefined
}

/** Holds active original bans against concurrent unbanning until session cleanup finishes. */
export async function lockActiveBanUsers(
  banIds: ReadonlyArray<string>,
  client: DbClient,
): Promise<SbUserId[]> {
  const result = await client.query<{ user_id: SbUserId }>(sql`
    SELECT user_id FROM user_bans
    WHERE id = ANY(${banIds}::uuid[]) AND end_time > ${new Date()} AND unbanned_at IS NULL
    ORDER BY id FOR UPDATE
  `)
  return [...new Set(result.rows.map(row => row.user_id))]
}
