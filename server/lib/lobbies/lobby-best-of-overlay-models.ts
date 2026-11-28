import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'

/** A logo as it is stored: where the file store holds it, and the name it was uploaded from. */
export interface StoredBestOfLogo {
  path: string
  fileName: string
}

/** The caster overlay a host last started or saved a best-of series with. */
export interface RememberedBestOfOverlay {
  line1?: string
  line2?: string
  logo?: StoredBestOfLogo
}

interface DbRememberedBestOfOverlay {
  line1: string | null
  line2: string | null
  logo_path: string | null
  logo_file_name: string | null
}

function fromDb(row: DbRememberedBestOfOverlay): RememberedBestOfOverlay {
  return {
    ...(row.line1 !== null ? { line1: row.line1 } : {}),
    ...(row.line2 !== null ? { line2: row.line2 } : {}),
    ...(row.logo_path !== null && row.logo_file_name !== null
      ? { logo: { path: row.logo_path, fileName: row.logo_file_name } }
      : {}),
  }
}

/**
 * Returns the caster overlay a user last started or saved a best-of series with, or `undefined` if
 * they have never started one.
 */
export async function getRememberedBestOfOverlay(
  userId: SbUserId,
  withClient?: DbClient,
): Promise<RememberedBestOfOverlay | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbRememberedBestOfOverlay>(sql`
      SELECT line1, line2, logo_path, logo_file_name
      FROM lobby_best_of_overlays
      WHERE user_id = ${userId};
    `)
    return result.rows.length > 0 ? fromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Stores the caster overlay a user's next best-of series starts with, replacing every part of
 * whatever was stored before (a part that isn't given is stored as not set).
 */
export async function setRememberedBestOfOverlay(
  userId: SbUserId,
  { line1, line2, logo }: RememberedBestOfOverlay,
  withClient?: DbClient,
): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      INSERT INTO lobby_best_of_overlays (user_id, line1, line2, logo_path, logo_file_name)
      VALUES (${userId}, ${line1 ?? null}, ${line2 ?? null}, ${logo?.path ?? null},
        ${logo?.fileName ?? null})
      ON CONFLICT (user_id)
      DO UPDATE SET
        line1 = EXCLUDED.line1,
        line2 = EXCLUDED.line2,
        logo_path = EXCLUDED.logo_path,
        logo_file_name = EXCLUDED.logo_file_name;
    `)
  } finally {
    done()
  }
}
