import { SbUserId } from '../../../common/users/sb-user-id'
import { UserIpInfo } from '../../../common/users/user-network'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

/** One or more times a user was seen at an IP address. */
export interface UserIpSighting {
  userId: SbUserId
  ipAddress: string
  /** How many times the user was seen at this address. */
  count: number
  /** When the user was most recently seen at this address. */
  lastSeen: Date
}

/**
 * Updates the IP addresses stored for users, creating or updating one row per user and address in
 * a single statement. This information is used for things like identifying users with multiple
 * accounts, avoiding bans, etc.
 *
 * Sightings are grouped by user and address first, since two spellings of one address are the same
 * row and a statement may only touch a row once.
 */
export async function upsertUserIpSightings(
  sightings: ReadonlyArray<UserIpSighting>,
  withClient?: DbClient,
): Promise<void> {
  if (!sightings.length) {
    return
  }

  const { client, done } = await db(withClient)
  try {
    // The times go through `to_timestamp` so they land in these columns the same way `NOW()`
    // would, whatever time zones this process and the database session are in.
    await client.query(sql`
      INSERT INTO user_ips (user_id, ip_address, first_used, last_used, times_seen)
      SELECT
        s.user_id,
        s.ip_address,
        to_timestamp(MAX(s.last_seen_ms) / 1000.0),
        to_timestamp(MAX(s.last_seen_ms) / 1000.0),
        SUM(s.times_seen)::integer
      FROM UNNEST(
        ${sightings.map(s => s.userId)}::integer[],
        ${sightings.map(s => s.ipAddress)}::inet[],
        ${sightings.map(s => s.lastSeen.getTime())}::double precision[],
        ${sightings.map(s => s.count)}::integer[]
      ) AS s(user_id, ip_address, last_seen_ms, times_seen)
      GROUP BY s.user_id, s.ip_address
      ON CONFLICT (user_id, ip_address)
      DO UPDATE
      SET last_used = GREATEST(user_ips.last_used, EXCLUDED.last_used),
      times_seen = user_ips.times_seen + EXCLUDED.times_seen
    `)
  } finally {
    done()
  }
}

type DbUserIpInfo = Dbify<UserIpInfo>

function toUserIpInfo(dbInfo: DbUserIpInfo): UserIpInfo {
  return {
    userId: dbInfo.user_id,
    ipAddress: dbInfo.ip_address,
    firstUsed: dbInfo.first_used,
    lastUsed: dbInfo.last_used,
    timesSeen: dbInfo.times_seen,
  }
}

/**
 * Retrieves all the IP addresses associated with the specified users, along with info about their
 * use.
 */
export async function retrieveIpsForUsers(
  users: ReadonlyArray<SbUserId>,
  withClient?: DbClient,
): Promise<UserIpInfo[]> {
  const { client, done } = await db(withClient)
  try {
    const res = await client.query(sql`
      SELECT user_id, ip_address, first_used, last_used, times_seen
      FROM user_ips
      WHERE user_id = ANY(${users})
      ORDER BY last_used DESC
    `)
    return res.rows.map(r => toUserIpInfo(r))
  } finally {
    done()
  }
}

/**
 * Retrieves all the users' IP info that have used the specified IP addresses, excluding entries
 * matching a specified ID (since this is used to find users related to a specific one).
 */
export async function retrieveRelatedUsersForIps(
  ips: ReadonlyArray<string>,
  excludeUser: SbUserId,
  withClient?: DbClient,
): Promise<Map<string, UserIpInfo[]>> {
  const { client, done } = await db(withClient)
  try {
    const res = await client.query(sql`
      SELECT user_id, ip_address, first_used, last_used, times_seen
      FROM user_ips
      WHERE ip_address = ANY(${ips})
      AND user_id != ${excludeUser}
      ORDER BY ip_address, last_used DESC
    `)
    const grouped = res.rows.reduce(
      (acc, r) => {
        const info = toUserIpInfo(r)
        const ip = info.ipAddress
        acc.get(ip)!.push(info)
        return acc
      },
      new Map<string, UserIpInfo[]>(ips.map(ip => [ip, []])),
    )
    return grouped
  } finally {
    done()
  }
}

/**
 * Removes user IP records that haven't been used since before the specified date.
 * Returns the number of records that were removed.
 */
export async function cleanupOldUserIps(
  removeBefore: Date,
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const res = await client.query(sql`
      DELETE FROM user_ips
      WHERE last_used < ${removeBefore}
    `)
    return res.rowCount ?? 0
  } finally {
    done()
  }
}
