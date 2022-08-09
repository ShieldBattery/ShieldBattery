import sql from 'sql-template-strings'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import { appendJoined } from '../db/queries'
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
    `

    for (let i = 0; i < identifiers.length; i++) {
      query.append(i !== 0 ? sql`, ` : sql` `)
      query.append(sql`(${userId}, ${identifiers[i][0]}, ${identifiers[i][1]}, NOW(), NOW(), 1)`)
    }

    query.append(sql`
      ON CONFLICT (user_id, identifier_type, identifier_hash)
      DO UPDATE
      SET last_used = NOW(),
      times_seen = ui.times_seen + 1
    `)

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
    const query = sql`
      SELECT user_id as "id"
      FROM user_identifiers ui
      WHERE ui.user_id != ${userId}
    `
    if (filterBrowserprint) {
      query.append(sql`
        AND ui.identifier_type != 0
      `)
    }

    query.append(sql`
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
    const query = sql`
      SELECT user_id as "id"
      FROM user_identifiers ui
      WHERE
    `
    if (filterBrowserprint) {
      query.append(sql`
        ui.identifier_type != 0 AND
      `)
    }

    appendJoined(
      query,
      identifiers.map(
        ([type, hash]) => sql` (ui.identifier_type = ${type} AND ui.identifier_hash = ${hash}) `,
      ),
      sql` OR `,
    )

    query.append(sql`
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
): Promise<number> {
  const { client, done } = await db(withClient)

  try {
    const query = sql`
      SELECT COUNT(DISTINCT identifier_type) as "matches"
      FROM user_identifier_bans uib
      WHERE (uib.identifier_type, uib.identifier_hash) IN (
        SELECT identifier_type, identifier_hash
        FROM user_identifiers ui
        WHERE ui.user_id = ${userId}
      )
      AND banned_until > NOW()
    `

    if (filterBrowserprint) {
      query.append(sql`
        AND uib.identifier_type != 0
      `)
    }

    const result = await client.query<{ matches: string }>(query)
    return result.rows.length > 0 ? Number(result.rows[0].matches) : 0
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
    `
    let appended = false
    for (const [type, hash] of identifiers) {
      if (appended) {
        query.append(sql` OR `)
      } else {
        appended = true
      }

      query.append(sql`
        (uib.identifier_type = ${type} AND uib.identifier_hash = ${hash})
      `)
    }
    query.append(sql`)`)

    const result = await client.query<{ matches: string }>(query)
    return result.rows.length > 0 ? Number(result.rows[0].matches) : 0
  } finally {
    done()
  }
}

export async function banAllIdentifiers(
  {
    userId,
    timeBanned = new Date(),
    bannedUntil,
    filterBrowserprint = true,
  }: {
    userId: SbUserId
    timeBanned?: Date
    bannedUntil: Date
    filterBrowserprint?: boolean
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)

  try {
    const query = sql`
      INSERT INTO user_identifier_bans AS uib
      SELECT
        identifier_type,
        identifier_hash,
        ${timeBanned} AS "time_banned",
        ${bannedUntil} AS "banned_until",
        user_id
      FROM user_identifiers
      WHERE user_id = ${userId}
    `

    if (filterBrowserprint) {
      query.append(sql`
        AND identifier_type != 0
      `)
    }

    // This will have the effect of permanently banning any users if they evade a ban (since that
    // ban is permanent). But that seems fine/desirable for now, maybe not in the far future.
    query.append(sql`
      ON CONFLICT (identifier_type, identifier_hash)
      DO UPDATE SET banned_until = GREATEST(uib.banned_until, EXCLUDED.banned_until)
    `)

    await client.query(query)
  } finally {
    done()
  }
}
