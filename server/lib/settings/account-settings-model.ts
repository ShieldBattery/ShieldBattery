import { AccountSettings } from '../../../common/settings/account-settings'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'

interface DbAccountSettings {
  settings: Partial<AccountSettings>
}

/**
 * Retrieves the raw stored settings for a user, or `undefined` if they've never changed any. The
 * returned object holds only the keys the user has changed; callers fill in the rest with
 * `fillAccountSettingsDefaults`.
 */
export async function getAccountSettings(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<Partial<AccountSettings> | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbAccountSettings>(sql`
      SELECT settings
      FROM account_settings
      WHERE user_id = ${userId}
    `)
    return result.rows[0]?.settings
  } finally {
    done()
  }
}

/**
 * Merges `patch` into a user's stored settings, creating the row if it doesn't exist yet, and
 * returns the resulting stored JSON. Only the keys present in `patch` are changed; callers fill in
 * the rest with `fillAccountSettingsDefaults`.
 */
export async function updateAccountSettings(
  userId: SbUserId,
  patch: Partial<AccountSettings>,
  withClient?: DbClient,
): Promise<Partial<AccountSettings>> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbAccountSettings>(sql`
      INSERT INTO account_settings (user_id, settings)
      VALUES (${userId}, ${patch})
      ON CONFLICT (user_id) DO UPDATE SET
        settings = account_settings.settings || EXCLUDED.settings,
        updated_at = now()
      RETURNING settings
    `)
    return result.rows[0].settings
  } finally {
    done()
  }
}
