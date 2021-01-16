import sql from 'sql-template-strings'
import {
  MatchmakingPreferences,
  MatchmakingType,
  StoredMatchmakingPreferences,
} from '../../../common/matchmaking'
import db from '../db'
import { Dbify } from '../db/types'

type DbMatchmakingPreferences = Dbify<StoredMatchmakingPreferences>

function convertFromDb(dbResult: DbMatchmakingPreferences): StoredMatchmakingPreferences {
  return {
    userId: dbResult.user_id,
    matchmakingType: dbResult.matchmaking_type,
    race: dbResult.race,
    useAlternateRace: dbResult.use_alternate_race,
    alternateRace: dbResult.alternate_race,
    mapPoolId: dbResult.map_pool_id,
    preferredMaps: dbResult.preferred_maps ?? [],
    updatedAt: dbResult.updated_at,
  }
}

export async function upsertMatchmakingPreferences(
  userId: number,
  {
    matchmakingType,
    race,
    useAlternateRace,
    alternateRace,
    mapPoolId,
    preferredMaps,
  }: MatchmakingPreferences,
): Promise<StoredMatchmakingPreferences> {
  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingPreferences>(sql`
      INSERT INTO matchmaking_preferences AS mp (user_id, matchmaking_type, race,
        use_alternate_race, alternate_race, map_pool_id, preferred_maps, updated_at)
      VALUES (${userId}, ${matchmakingType}, ${race}, ${useAlternateRace}, ${alternateRace},
        ${mapPoolId}, ${preferredMaps}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      ON CONFLICT (user_id, matchmaking_type)
      DO UPDATE SET race = ${race}, use_alternate_race = ${useAlternateRace},
        alternate_race = ${alternateRace}, map_pool_id = ${mapPoolId},
        preferred_maps = ${preferredMaps}, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
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
): Promise<StoredMatchmakingPreferences | null> {
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
