import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db/index'
import { sql, sqlRaw } from '../db/sql'

export async function addPasswordResetCode(
  { userId, code, ip }: { userId: SbUserId; code: string; ip: string },
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      INSERT INTO password_resets
        (user_id, reset_code, request_ip)
      VALUES
        (${userId}, ${code}, ${ip})
    `)
  } finally {
    done()
  }
}

const PASSWORD_RESET_CODE_INTERVAL = '2 hour'

/**
 * Attempt to use a password reset code. If successful, the user ID the code was for will be
 * returned. If the code isn't valid, is expired, or is already used, undefined will be returned.
 *
 * This should always be done with a transaction client that also handles setting the password, as
 * the code should not be exhausted if setting the new password fails for some reason.
 */
export async function usePasswordResetCode(
  code: string,
  withClient: DbClient,
): Promise<SbUserId | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ user_id: SbUserId }>(sql`
      UPDATE password_resets
      SET exhausted = true
      WHERE
        reset_code = ${code} AND
        exhausted = false AND
        request_time > now() - interval '${sqlRaw(PASSWORD_RESET_CODE_INTERVAL)}'
      RETURNING user_id
    `)

    return result.rowCount ? result.rows[0].user_id : undefined
  } finally {
    done()
  }
}

/**
 * Exhausts all password reset codes that are older than the expiration time. This should be used
 * by a periodic job to clean up old codes just to reduce the potential for collisions when
 * generating new codes (even though it is quite small anyway). Returns the number of codes that
 * were exhausted.
 */
export async function exhaustOldPasswordResetCodes(): Promise<number> {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      UPDATE password_resets
      SET exhausted = true
      WHERE
        exhausted = false AND
        request_time < now() - interval '${sqlRaw(PASSWORD_RESET_CODE_INTERVAL)}'
    `)
    return result.rowCount ?? 0
  } finally {
    done()
  }
}
