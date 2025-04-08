import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql, sqlConcat } from '../db/sql'
import { Dbify } from '../db/types'
import { ClientIdentifierBuffer } from './client-ids'

interface UserIdentifier {
  userId: SbUserId
  identifierType: number
  identifierHash: Buffer
  firstUsed: Date
  lastUsed: Date
  timesSeen: number
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type DbUserIdentifier = Dbify<UserIdentifier>

export async function upsertUserIdentifiers(
  userId: SbUserId,
  identifiers: ReadonlyArray<[type: number, hash: Buffer]>,
  withClient?: DbClient,
): Promise<void> {
  if (!identifiers.length) {
    return
  }

  const { client, done } = await db(withClient)
  try {
    const query = sql`
      INSERT INTO user_identifiers AS ui
      (user_id, identifier_type, identifier_hash, first_used, last_used, times_seen)
      VALUES
      ${sqlConcat(
        ', ',
        identifiers.map(ident => {
          return sql`(${userId}, ${ident[0]}, ${ident[1]}, NOW(), NOW(), 1)`
        }),
      )}
      ON CONFLICT (user_id, identifier_type, identifier_hash)
      DO UPDATE
      SET last_used = NOW(),
      times_seen = ui.times_seen + 1
    `

    await client.query(query)
  } finally {
    done()
  }
}

/**
 * Returns a list of user IDs connected to the current one by having at least `minSameIdentifiers`
 * identifiers in common.
 */
export async function findConnectedUsers(
  userId: SbUserId,
  minSameIdentifiers: number,
  filterBrowserprint = true,
  withClient?: DbClient,
): Promise<SbUserId[]> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`
      SELECT user_id as "id"
      FROM user_identifiers ui
      WHERE ui.user_id != ${userId}
    `
    if (filterBrowserprint) {
      query = query.append(sql`
        AND ui.identifier_type != 0
      `)
    }

    query = query.append(sql`
      AND (ui.identifier_type, ui.identifier_hash) IN (
        SELECT identifier_type, identifier_hash
        FROM user_identifiers ui2
        WHERE ui2.user_id = ${userId}
      )
      GROUP BY ui.user_id
      HAVING COUNT(DISTINCT identifier_type) >= ${minSameIdentifiers}
    `)

    const result = await client.query<{ id: SbUserId }>(query)
    return result.rows.map(r => r.id)
  } finally {
    done()
  }
}

/**
 * Returns a list of user IDs with identifiers that match the ones specified. The identifiers
 * should correspond to a single machine.
 */
export async function findUsersWithIdentifiers(
  identifiers: ReadonlyArray<ClientIdentifierBuffer>,
  minSameIdentifiers: number,
  filterBrowserprint = true,
  withClient?: DbClient,
): Promise<SbUserId[]> {
  const { client, done } = await db(withClient)
  try {
    let query = sql`
      SELECT user_id as "id"
      FROM user_identifiers ui
      WHERE
    `
    if (filterBrowserprint) {
      query = query.append(sql`
        ui.identifier_type != 0 AND
      `)
    }

    query = query.append(
      sqlConcat(
        ' OR ',
        identifiers.map(
          ([type, hash]) => sql` (ui.identifier_type = ${type} AND ui.identifier_hash = ${hash}) `,
        ),
      ),
    )

    query = query.append(sql`
      GROUP BY ui.user_id
      HAVING COUNT(DISTINCT identifier_type) >= ${minSameIdentifiers}
    `)
    const result = await client.query<{ id: SbUserId }>(query)
    return result.rows.map(r => r.id)
  } finally {
    done()
  }
}

export async function countBannedUserIdentifiers(
  userId: SbUserId,
  filterBrowserprint = true,
  withClient?: DbClient,
): Promise<[count: number, latestBanEnd: Date | undefined]> {
  const { client, done } = await db(withClient)

  try {
    let query = sql`
      SELECT COUNT(DISTINCT identifier_type) as "matches",
             MAX(banned_until) as "latest"
      FROM user_identifier_bans uib
      WHERE (uib.identifier_type, uib.identifier_hash) IN (
        SELECT identifier_type, identifier_hash
        FROM user_identifiers ui
        WHERE ui.user_id = ${userId}
      )
      AND banned_until > NOW()
    `

    if (filterBrowserprint) {
      query = query.append(sql`
        AND uib.identifier_type != 0
      `)
    }

    const result = await client.query<{ matches: string; latest: Date | null }>(query)
    if (result.rows.length > 0) {
      const matches = Number(result.rows[0].matches)
      const latestBanEnd = result.rows[0].latest ?? undefined
      return [matches, latestBanEnd]
    } else {
      return [0, undefined]
    }
  } finally {
    done()
  }
}

/**
 * Counts the number of banned identifiers from the given list. This should only be used when a
 * user ID is not yet known (e.g. before signup), otherwise use `countBannedUserIdentifiers`.
 */
export async function countBannedIdentifiers(
  identifiers: ReadonlyArray<[type: number, hash: Buffer]>,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)

  try {
    const query = sql`
      SELECT COUNT(DISTINCT identifier_type) as "matches"
      FROM user_identifier_bans uib
      WHERE banned_until > NOW()
      AND (
        ${sqlConcat(
          ' OR ',
          identifiers.map(([type, hash]) => {
            return sql`(uib.identifier_type = ${type} AND uib.identifier_hash = ${hash})`
          }),
        )}
      )
    `

    const result = await client.query<{ matches: string }>(query)
    return result.rows.length > 0 ? Number(result.rows[0].matches) : 0
  } finally {
    done()
  }
}

export async function banAllIdentifiers(
  {
    users,
    timeBanned = new Date(),
    bannedUntil,
    filterBrowserprint = true,
  }: {
    users: ReadonlyArray<SbUserId>
    timeBanned?: Date
    bannedUntil: Date
    filterBrowserprint?: boolean
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)

  try {
    let query = sql`
      INSERT INTO user_identifier_bans AS uib (
        identifier_type, identifier_hash, time_banned, banned_until, first_user_id
      )
      SELECT DISTINCT ON (identifier_type, identifier_hash)
        identifier_type,
        identifier_hash,
        ${timeBanned} AS "time_banned",
        ${bannedUntil} AS "banned_until",
        user_id
      FROM user_identifiers
      WHERE user_id = ANY(${users})
    `

    if (filterBrowserprint) {
      query = query.append(sql`
        AND identifier_type != 0
      `)
    }

    // This will have the effect of permanently banning any users if they evade a ban (since that
    // ban is permanent). But that seems fine/desirable for now, maybe not in the far future.
    query = query.append(sql`
      ON CONFLICT (identifier_type, identifier_hash)
      DO UPDATE SET banned_until = GREATEST(uib.banned_until, EXCLUDED.banned_until)
    `)

    await client.query(query)
  } finally {
    done()
  }
}

/**
 * Cleans up any identifiers that haven't been used since `olderThan`, provided they have not been
 * the subject of a ban for any user. Returns the number of identifiers cleaned up.
 */
export async function cleanupUnbannedIdentifiers(
  olderThan: Date,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query(sql`
      DELETE FROM user_identifiers ui
      WHERE ui.last_used < ${olderThan}
      AND NOT EXISTS (
        SELECT
        FROM user_identifier_bans uib
        WHERE uib.identifier_hash = ui.identifier_hash
        AND uib.identifier_type = ui.identifier_type
      )
    `)

    return result.rowCount ?? 0
  } finally {
    done()
  }
}
