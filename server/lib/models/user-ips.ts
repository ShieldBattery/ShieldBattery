import sql from 'sql-template-strings'
import { container } from 'tsyringe'
import { SbUserId } from '../../../common/users/sb-user'
import db from '../db'
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
