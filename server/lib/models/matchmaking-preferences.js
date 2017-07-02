import db from '../db'

class MatchmakingPreferences {
  constructor(props) {
    this.race = props.race
    this.alternateRace = props.alternate_race
    this.mapPoolId = props.map_pool_id
    this.preferredMaps = (props.preferred_maps || []).map(m => m.toString('hex'))
  }
}

export async function upsertMatchmakingPreferences(
  userId,
  matchmakingType,
  race,
  alternateRace = null,
  mapPoolId,
  preferredMaps,
) {
  const query = `
    INSERT INTO matchmaking_preferences (user_id, matchmaking_type, race, alternate_race,
      map_pool_id, preferred_maps)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id, matchmaking_type)
    DO UPDATE SET race = $3, alternate_race = $4, map_pool_id = $5, preferred_maps = $6
    WHERE matchmaking_preferences.user_id = $1 AND matchmaking_preferences.matchmaking_type = $2
    RETURNING *;
  `
  const preferredMapsHashes = preferredMaps ? preferredMaps.map(m => Buffer.from(m, 'hex')) : null
  const params = [userId, matchmakingType, race, alternateRace, mapPoolId, preferredMapsHashes]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return new MatchmakingPreferences(result.rows[0])
  } finally {
    done()
  }
}

export async function getMatchmakingPreferences(userId, matchmakingType) {
  const query = `
    SELECT user_id, matchmaking_type, race, alternate_race, map_pool_id, preferred_maps
    FROM matchmaking_preferences
    WHERE user_id = $1 AND matchmaking_type = $2;
  `
  const params = [userId, matchmakingType]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? new MatchmakingPreferences(result.rows[0]) : null
  } finally {
    done()
  }
}
