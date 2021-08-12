import sql from 'sql-template-strings'
import { MatchmakingPreferences, MatchmakingType } from '../../../common/matchmaking'
import db from '../db'
import { Dbify } from '../db/types'

type DbMatchmakingPreferences = Dbify<MatchmakingPreferences>

function convertFromDb(dbResult: DbMatchmakingPreferences): MatchmakingPreferences {
  return {
    userId: dbResult.user_id,
    matchmakingType: dbResult.matchmaking_type,
    race: dbResult.race,
    mapPoolId: dbResult.map_pool_id,
    mapSelections: dbResult.map_selections,
    data: dbResult.data,
  } as MatchmakingPreferences
}

/**
 * Saves the given matchmaking preferences for a given user and matchmaking type combination. In
 * case the preferences already existed, they're updated with new values. Returns the updated
 * preferences (or new ones in case they were saved for the first time).
 */
export async function upsertMatchmakingPreferences({
  userId,
  matchmakingType,
  race,
  mapPoolId,
  mapSelections,
  data = {},
}: MatchmakingPreferences): Promise<MatchmakingPreferences> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingPreferences>(sql`
      INSERT INTO matchmaking_preferences AS mp
        (user_id, matchmaking_type, race, map_pool_id, map_selections, data)
      VALUES
        (${userId}, ${matchmakingType}, ${race}, ${mapPoolId}, ${mapSelections}, ${data})
      ON CONFLICT (user_id, matchmaking_type)
      DO UPDATE SET
        race = ${race}, map_pool_id = ${mapPoolId}, map_selections=${mapSelections}, data = ${data}
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
  userId: number,
  matchmakingType: MatchmakingType,
): Promise<MatchmakingPreferences | null> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingPreferences>(sql`
      SELECT *
      FROM matchmaking_preferences
      WHERE user_id = ${userId} AND matchmaking_type = ${matchmakingType}
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}
