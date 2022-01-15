import sql from 'sql-template-strings'
import { SbUserId } from '../../../common/users/sb-user'
import db, { DbClient } from '../db'

export async function addEmailVerificationCode(
  {
    userId,
    email,
    code,
    ip,
  }: {
    userId: SbUserId
    email: string
    code: string
    ip: string
  },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      INSERT INTO email_verifications
      (user_id, email, verification_code, request_time, request_ip)
      VALUES (${userId}, ${email}, ${code}, ${new Date()}, ${ip})
    `)
  } finally {
    done()
  }
}

export async function getEmailVerificationsCount(
  { id, email }: { id: SbUserId; email: string },
  withClient?: DbClient,
): Promise<number> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ count: string }>(sql`
      SELECT COUNT(*) AS count
      FROM email_verifications
      WHERE user_id = ${id} AND email = ${email}
    `)

    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

export async function consumeEmailVerificationCode(
  {
    id,
    email,
    code,
  }: {
    id: SbUserId
    email: string
    code: string
  },
  withClient?: DbClient,
): Promise<boolean> {
  const { client, done } = await db(withClient)
  try {
    // TODO(tec27): If we save an audit of these changes at some point, we'd only want to update
    // accounts that aren't already marked verified.
    const result = await client.query(sql`
      UPDATE users u
      SET email_verified = TRUE
      FROM email_verifications ev
      WHERE
        ev.user_id = ${id} AND
        ev.email = ${email} AND
        ev.user_id = u.id AND
        ev.email = u.email AND
        ev.verification_code = ${code} AND
        ev.request_time > (NOW() - INTERVAL '2 DAYS')
      RETURNING *
    `)
    return result.rows.length > 0
  } finally {
    done()
  }
}
