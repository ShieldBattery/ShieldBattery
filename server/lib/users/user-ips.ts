import sql from 'sql-template-strings'
import { container } from 'tsyringe'
import { SbUserId, UserIpInfo } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'
import { Dbify } from '../db/types'
import { UpsertUserIp } from '../network/user-ips-type'

/**
 * Updates information about this user's IP address stored in the database. This information is used
 * for things like identifying users with multiple accounts, avoiding bans, etc.
 */
export async function upsertUserIp(userId: SbUserId, ipAddress: string): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      INSERT INTO user_ips (user_id, ip_address, first_used, last_used, times_seen)
      VALUES (${userId}, ${ipAddress}, NOW(), NOW(), 1)
      ON CONFLICT (user_id, ip_address)
      DO UPDATE
      SET last_used = NOW(),
      times_seen = user_ips.times_seen + 1
    `)
  } finally {
    done()
  }
}

container.register<UpsertUserIp>('upsertUserIp', { useValue: upsertUserIp })

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

/** Retrieves all the IP addresses associated with a user, along with info about their use. */
export async function retrieveIpsForUser(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<UserIpInfo[]> {
  const { client, done } = await db(withClient)
  try {
    const res = await client.query(sql`
      SELECT user_id, ip_address, first_used, last_used, times_seen
      FROM user_ips
      WHERE user_id = ${userId}
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
    const grouped = res.rows.reduce((acc, r) => {
      const info = toUserIpInfo(r)
      const ip = info.ipAddress
      acc.get(ip)!.push(info)
      return acc
    }, new Map<string, UserIpInfo[]>(ips.map(ip => [ip, []])))
    return grouped
  } finally {
    done()
  }
}
