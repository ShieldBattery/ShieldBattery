import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'

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
      (user_id, email, verification_code, request_ip)
      VALUES (${userId}, ${email}, ${code}, ${ip})
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

export async function consumeEmailVerificationCode({
  userId,
  code,
}: {
  userId: SbUserId
  code: string
}): Promise<boolean> {
  return await transact(async client => {
    // TODO(tec27): If we save an audit of these changes at some point, we'd only want to update
    // accounts that aren't already marked verified.
    const result = await client.query(sql`
      UPDATE users u
      SET email_verified = TRUE
      FROM email_verifications ev
      WHERE
        ev.user_id = u.id AND
        ev.email = u.email AND
        ev.user_id = ${userId} AND
        ev.verification_code = ${code} AND
        ev.request_time > (NOW() - INTERVAL '2 DAYS') AND
        ev.exhausted = FALSE
    `)

    if (result.rowCount) {
      await client.query(sql`
        UPDATE email_verifications
        SET exhausted = TRUE
        WHERE
          user_id = ${userId} AND
          verification_code = ${code};
      `)
    }

    return !!result.rowCount
  })
}
