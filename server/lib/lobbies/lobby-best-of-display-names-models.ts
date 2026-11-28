import { BestOfDisplayName } from '../../../common/lobbies/lobby-best-of'
import { SbUserId } from '../../../common/users/sb-user-id'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'

/** How many remembered display names are kept per host: the most recently used ones. */
export const MAX_REMEMBERED_DISPLAY_NAMES_PER_HOST = 200

/** A display name a host gave a player, or `undefined` for one the host cleared. */
export interface RememberedDisplayNameChange {
  userId: SbUserId
  name: string | undefined
}

interface DbRememberedDisplayName {
  player_id: SbUserId
  display_name: string
}

/**
 * Returns the display names a host is remembered to have last given any of `playerIds`. Players the
 * host has none remembered for are left out.
 */
export async function getRememberedBestOfDisplayNames(
  hostId: SbUserId,
  playerIds: ReadonlyArray<SbUserId>,
  withClient?: DbClient,
): Promise<BestOfDisplayName[]> {
  if (!playerIds.length) {
    return []
  }
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbRememberedDisplayName>(sql`
      SELECT player_id, display_name
      FROM lobby_best_of_display_names
      WHERE host_id = ${hostId} AND player_id = ANY(${playerIds})
      ORDER BY player_id;
    `)
    return result.rows.map(row => ({ userId: row.player_id, name: row.display_name }))
  } finally {
    done()
  }
}

/**
 * Remembers the display names a host just gave players, as the most recently used ones, and forgets
 * the ones the host cleared. Then drops the host's least recently used names beyond
 * `MAX_REMEMBERED_DISPLAY_NAMES_PER_HOST`.
 */
export async function rememberBestOfDisplayNames(
  hostId: SbUserId,
  changes: ReadonlyArray<RememberedDisplayNameChange>,
): Promise<void> {
  if (!changes.length) {
    return
  }
  const playerIds = changes.map(change => change.userId)
  const names = changes.map(change => change.name ?? null)
  await transact(async client => {
    await client.query(sql`
      WITH changes AS (
        SELECT *
        FROM unnest(${playerIds}::integer[], ${names}::text[]) AS c(player_id, display_name)
      ), forgotten AS (
        DELETE FROM lobby_best_of_display_names d
        USING changes c
        WHERE d.host_id = ${hostId} AND d.player_id = c.player_id AND c.display_name IS NULL
      )
      INSERT INTO lobby_best_of_display_names (host_id, player_id, display_name, used_at)
      SELECT ${hostId}, player_id, display_name, now()
      FROM changes
      WHERE display_name IS NOT NULL
      ON CONFLICT (host_id, player_id)
      DO UPDATE SET
        display_name = EXCLUDED.display_name,
        used_at = EXCLUDED.used_at;
    `)
    await client.query(sql`
      DELETE FROM lobby_best_of_display_names
      WHERE host_id = ${hostId} AND player_id IN (
        SELECT player_id
        FROM lobby_best_of_display_names
        WHERE host_id = ${hostId}
        ORDER BY used_at DESC, player_id
        OFFSET ${MAX_REMEMBERED_DISPLAY_NAMES_PER_HOST}
      );
    `)
  })
}
