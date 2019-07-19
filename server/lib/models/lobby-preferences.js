import db from '../db'

class LobbyPreferences {
  constructor(props) {
    this.name = props.name
    this.gameType = props.game_type
    this.gameSubType = props.game_sub_type
    this.recentMaps = (props.recent_maps || []).map(m => m.toString('hex'))
    this.selectedMap = props.selected_map
  }
}

export async function upsertLobbyPreferences(
  userId,
  name = null,
  gameType = null,
  gameSubType = null,
  recentMaps = [],
  selectedMap = null,
) {
  const query = `
    INSERT INTO lobby_preferences
      (user_id, name, game_type, game_sub_type, recent_maps, selected_map)
    VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (user_id)
    DO UPDATE SET name = $2, game_type = $3, game_sub_type = $4, recent_maps = $5, selected_map = $6
    WHERE lobby_preferences.user_id = $1
    RETURNING *;
  `
  const recentMapsHashes = recentMaps ? recentMaps.map(m => Buffer.from(m, 'hex')) : null
  const selectedMapHash = selectedMap ? Buffer.from(selectedMap, 'hex') : null
  const params = [userId, name, gameType, gameSubType, recentMapsHashes, selectedMapHash]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return new LobbyPreferences(result.rows[0])
  } finally {
    done()
  }
}

export async function getLobbyPreferences(userId) {
  const query = `
    SELECT *
    FROM lobby_preferences
    WHERE user_id = $1;
  `
  const params = [userId]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? new LobbyPreferences(result.rows[0]) : null
  } finally {
    done()
  }
}
