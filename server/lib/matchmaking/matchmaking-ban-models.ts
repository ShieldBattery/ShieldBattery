import { ReadonlyDeep } from 'type-fest'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql, sqlConcat } from '../db/sql'
import { Dbify } from '../db/types'
import { ClientIdentifierBuffer } from '../users/client-ids'

export interface MatchmakingBanRow {
  id: string
  identifierType: number
  identifierHash: Buffer
  triggeredBy?: SbUserId
  banLevel: number
  createdAt: Date
  expiresAt: Date
  clearsAt: Date
  // NOTE(tec27): `cleared` is excluded as it is not safe to use for logic, since it is only set
  // periodically and not automatically when `clearsAt` passes. Any logic should simply use
  // `clearsAt` instead.
}
type DbMatchmakingBanRow = Dbify<MatchmakingBanRow>

function convertMatchmakingBanRowFromDb(dbRow: DbMatchmakingBanRow): MatchmakingBanRow {
  return {
    id: dbRow.id,
    identifierType: dbRow.identifier_type,
    identifierHash: dbRow.identifier_hash,
    triggeredBy: dbRow.triggered_by !== null ? dbRow.triggered_by : undefined,
    banLevel: dbRow.ban_level,
    createdAt: dbRow.created_at,
    expiresAt: dbRow.expires_at,
    clearsAt: dbRow.clears_at,
  }
}

/**
 * Sets the `cleared` flag on any bans that have been completely cleared. Intended to be called from
 * a periodic job. Returns how many bans were marked.
 */
export async function markClearedBans(now = new Date(), withClient?: DbClient): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const targetDate = new Date(now)
    targetDate.setMinutes(targetDate.getMinutes() - 5) // Add a bit of slop to avoid race conditions
    const result = await client.query(sql`
      UPDATE matchmaking_bans
      SET cleared = true
      WHERE
        cleared = false AND
        clears_at < ${targetDate}
    `)
    return result.rowCount ?? 0
  } finally {
    done()
  }
}

/**
 * Checks for any active matchmaking bans for a user based on their identifiers. If any active bans
 * are found, the latest expiring ban is returned. Otherwise, `undefined` will be returned.
 */
export async function checkActiveMatchmakingBan(
  {
    userId,
    now = new Date(),
    minSameIdentifiers,
  }: {
    userId: SbUserId
    now?: Date
    minSameIdentifiers?: number
  },
  withClient?: DbClient,
): Promise<MatchmakingBanRow | undefined> {
  const { client, done } = await db(withClient)
  try {
    // A ban is applicable if:
    // - There are at least `minSameIdentifiers` bans with identical level + expires_at that match
    //   associated identifiers, or
    // - There is at least one ban with `triggered_by` = `userId`
    // If we find applicable bans, we return the one with the latest `expires_at` since that is the
    // most relevant one to display to the user.
    const result = await client.query<DbMatchmakingBanRow>(sql`
        WITH matching_id_bans AS (
          SELECT COUNT(mb.ban_level) OVER w AS num_matches, first_value(mb.id) OVER w AS id,
            mb.ban_level, mb.expires_at
          FROM matchmaking_bans mb
          JOIN user_identifiers ui ON
            (ui.identifier_type, ui.identifier_hash) =
              (mb.identifier_type, mb.identifier_hash)
          WHERE ui.user_id = ${userId} AND
            ui.identifier_type != 0 AND
            mb.cleared = false AND
            mb.expires_at > ${now}
          WINDOW w AS (PARTITION BY mb.ban_level, mb.expires_at)
        ),
        all_matching_bans AS (
          SELECT mb.id, mb.identifier_type, mb.identifier_hash, mb.triggered_by,
            mb.ban_level, mb.created_at, mb.expires_at, mb.clears_at
          FROM matchmaking_bans mb
          WHERE mb.triggered_by = ${userId} AND
            mb.cleared = false AND
            mb.expires_at > ${now}
          UNION
            SELECT mb.id, mb.identifier_type, mb.identifier_hash, mb.triggered_by,
              mb.ban_level, mb.created_at, mb.expires_at, mb.clears_at
            FROM matchmaking_bans mb
            JOIN matching_id_bans mib ON mb.id = mib.id
            WHERE mib.num_matches >= ${minSameIdentifiers}
        )
        SELECT *
        FROM all_matching_bans
        ORDER BY expires_at DESC
        LIMIT 1
      `)
    return result.rows.length > 0 ? convertMatchmakingBanRowFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Checks for any uncleared matchmaking bans for a user based on their identifiers. If any uncleared
 * bans are found, the one with the highest level will be returned. Otherwise, `undefined` will be
 * returned.
 */
export async function checkUnclearedMatchmakingBan(
  {
    userId,
    now = new Date(),
    minSameIdentifiers,
  }: {
    userId: SbUserId
    now?: Date
    minSameIdentifiers?: number
  },
  withClient?: DbClient,
): Promise<MatchmakingBanRow | undefined> {
  const { client, done } = await db(withClient)
  try {
    // A ban is applicable if:
    // - There are at least `minSameIdentifiers` bans with identical level + expires_at that match
    //   associated identifiers, or
    // - There is at least one ban with `triggered_by` = `userId`
    // If we find applicable bans, we return the one with the highest `ban_level` since that is the
    // most relevant one for using uncleared bans.
    const result = await client.query<DbMatchmakingBanRow>(sql`
        WITH matching_id_bans AS (
          SELECT COUNT(mb.ban_level) OVER w AS num_matches, first_value(mb.id) OVER w AS id,
            mb.ban_level, mb.expires_at
          FROM matchmaking_bans mb
          JOIN user_identifiers ui ON
            (ui.identifier_type, ui.identifier_hash) =
              (mb.identifier_type, mb.identifier_hash)
          WHERE ui.user_id = ${userId} AND
            ui.identifier_type != 0 AND
            mb.cleared = false AND
            mb.clears_at > ${now}
          WINDOW w AS (PARTITION BY mb.ban_level, mb.expires_at)
        ),
        all_matching_bans AS (
          SELECT mb.id, mb.identifier_type, mb.identifier_hash, mb.triggered_by,
            mb.ban_level, mb.created_at, mb.expires_at, mb.clears_at
          FROM matchmaking_bans mb
          WHERE mb.triggered_by = ${userId} AND
            mb.cleared = false AND
            mb.clears_at > ${now}
          UNION
            SELECT mb.id, mb.identifier_type, mb.identifier_hash, mb.triggered_by,
              mb.ban_level, mb.created_at, mb.expires_at, mb.clears_at
            FROM matchmaking_bans mb
            JOIN matching_id_bans mib ON mb.id = mib.id
            WHERE mib.num_matches >= ${minSameIdentifiers}
        )
        SELECT *
        FROM all_matching_bans
        ORDER BY ban_level DESC, clears_at DESC
        LIMIT 1
    `)
    return result.rows.length > 0 ? convertMatchmakingBanRowFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

export async function addMatchmakingBan(
  {
    userId,
    identifiers,
    banLevel,
    banDurationMillis,
    clearDurationMillis,
    now = new Date(),
  }: {
    userId: SbUserId
    identifiers: ReadonlyDeep<ClientIdentifierBuffer[]>
    banLevel: number
    banDurationMillis: number
    clearDurationMillis: number
    now?: Date
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  const expiresAt = new Date(now.getTime() + banDurationMillis)
  const clearsAt = new Date(now.getTime() + clearDurationMillis)
  try {
    await client.query<DbMatchmakingBanRow>(sql`
      INSERT INTO matchmaking_bans
        (identifier_type, identifier_hash, triggered_by, ban_level, created_at, expires_at,
          clears_at)
      VALUES
        ${sqlConcat(
          ', ',
          identifiers.map(
            ([type, hash]) =>
              sql`(${type}, ${hash}, ${userId}, ${banLevel}, ${now}, ${expiresAt}, ${clearsAt})`,
          ),
        )}
    `)
  } finally {
    done()
  }
}
