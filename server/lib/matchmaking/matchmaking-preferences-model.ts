import {
  defaultPreferenceData,
  MatchmakingPreferences,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

type DbMatchmakingPreferences = Dbify<MatchmakingPreferences> & { selected: boolean }

export interface StoredMatchmakingPreferences {
  preferences: MatchmakingPreferences
  /**
   * Whether this type was part of the user's most recent matchmaking search. Drives the default mode
   * selection on the find-match page so users don't have to re-check their modes every session.
   */
  selected: boolean
}

function convertFromDb(dbResult: DbMatchmakingPreferences): StoredMatchmakingPreferences {
  return {
    preferences: {
      userId: dbResult.user_id,
      matchmakingType: dbResult.matchmaking_type,
      race: dbResult.race,
      mapPoolId: dbResult.map_pool_id,
      mapSelections: dbResult.map_selections,
      data: dbResult.data,
    } as MatchmakingPreferences,
    selected: dbResult.selected,
  }
}

/**
 * Saves the given matchmaking preferences for a given user and matchmaking type combination. In
 * case the preferences already existed, they're updated with new values. Returns the updated
 * preferences (or new ones in case they were saved for the first time).
 *
 * This method accepts partial preferences, replacing missing fields with their default values if no
 * previous preferences were set, or with the previous values if they were set.
 */
export async function upsertMatchmakingPreferences({
  userId,
  matchmakingType,
  race,
  mapPoolId,
  mapSelections,
  data,
}: PartialMatchmakingPreferences): Promise<StoredMatchmakingPreferences> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingPreferences>(sql`
      INSERT INTO matchmaking_preferences AS mp
        (user_id, matchmaking_type, race, map_pool_id, map_selections, data)
      VALUES
        (${userId}, ${matchmakingType}, ${race ?? 'r'}, ${mapPoolId ?? 1},
          ${mapSelections ?? []}, ${data ?? defaultPreferenceData(matchmakingType)})
      ON CONFLICT (user_id, matchmaking_type)
      DO UPDATE SET
        race = COALESCE(${race}, mp.race),
        map_pool_id = COALESCE(${mapPoolId}, mp.map_pool_id),
        map_selections = COALESCE(${mapSelections}, mp.map_selections),
        data = COALESCE(${data}, mp.data)
      WHERE mp.user_id = ${userId} AND mp.matchmaking_type = ${matchmakingType}
      RETURNING *;
    `)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

/**
 * Retrieve the latest `MatchmakingPreferences` for a user for a particular matchmaking type, or
 * `null` if they haven't set any yet.
 */
export async function getMatchmakingPreferences(
  userId: SbUserId,
  matchmakingType: MatchmakingType,
): Promise<StoredMatchmakingPreferences | undefined> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingPreferences>(sql`
      SELECT *
      FROM matchmaking_preferences
      WHERE user_id = ${userId} AND matchmaking_type = ${matchmakingType}
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : undefined
  } finally {
    done()
  }
}

/**
 * Records which matchmaking types the given user most recently searched for, marking exactly those
 * types `selected` and clearing the flag on all of their other types in a single statement. The
 * find-match page seeds its default mode selection from these flags. Only updates rows that already
 * exist; callers should upsert the queued types' preferences first so their rows are present.
 */
export async function setSelectedMatchmakingTypes(
  userId: SbUserId,
  selectedTypes: ReadonlyArray<MatchmakingType>,
): Promise<void> {
  const { client, done } = await db()
  try {
    await client.query(sql`
      UPDATE matchmaking_preferences
      SET selected = (matchmaking_type = ANY(${selectedTypes}::matchmaking_type[]))
      WHERE user_id = ${userId}
    `)
  } finally {
    done()
  }
}
