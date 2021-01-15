import db from '../db'
import sql from 'sql-template-strings'

class MatchmakingPreferences {
  constructor(props) {
    this.matchmakingType = props.matchmaking_type
    this.race = props.race
    this.useAlternateRace = props.use_alternate_race
    this.alternateRace = props.alternate_race
    this.mapPoolId = props.map_pool_id
    this.preferredMaps = props.preferred_maps || []
  }
}

export async function upsertMatchmakingPreferences(
  userId,
  matchmakingType,
  race,
  useAlternateRace,
  alternateRace,
  mapPoolId,
  preferredMaps,
) {
  const query = sql`
    INSERT INTO matchmaking_preferences AS mp (user_id, matchmaking_type, race, use_alternate_race,
      alternate_race, map_pool_id, preferred_maps, updated_at)
    VALUES (${userId}, ${matchmakingType}, ${race}, ${useAlternateRace}, ${alternateRace},
      ${mapPoolId}, ${preferredMaps}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT (user_id, matchmaking_type)
    DO UPDATE SET race = ${race}, use_alternate_race = ${useAlternateRace},
      alternate_race = ${alternateRace}, map_pool_id = ${mapPoolId},
      preferred_maps = ${preferredMaps}, updated_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    WHERE mp.user_id = ${userId} AND mp.matchmaking_type = ${matchmakingType}
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return new MatchmakingPreferences(result.rows[0])
  } finally {
    done()
  }
}

export async function getMatchmakingPreferences(userId, matchmakingType) {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      SELECT *
      FROM matchmaking_preferences
      WHERE user_id = ${userId} AND matchmaking_type = ${matchmakingType}
    `)
    return result.rows.length > 0 ? new MatchmakingPreferences(result.rows[0]) : null
  } finally {
    done()
  }
}
