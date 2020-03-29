import db from '../db'
import SQL from 'sql-template-strings'

class MapPreferences {
  constructor(props) {
    this.visibility = props.visibility
    this.thumbnailSize = props.thumbnail_size
    this.sortOption = props.sort_option
    this.numPlayersFilter = props.num_players_filter
    this.tilesetFilter = props.tileset_filter
  }
}

export async function upsertMapPreferences(
  userId,
  visibility = null,
  thumbnailSize = null,
  sortOption = null,
  numPlayersFilter = [],
  tilesetFilter = [],
) {
  const query = SQL`
    INSERT INTO map_preferences (
      user_id, visibility, thumbnail_size, sort_option, num_players_filter, tileset_filter
    )
    VALUES (
      ${userId}, ${visibility}, ${thumbnailSize}, ${sortOption}, ${numPlayersFilter},
      ${tilesetFilter}
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      visibility = ${visibility}, thumbnail_size = ${thumbnailSize},sort_option = ${sortOption},
      num_players_filter = ${numPlayersFilter}, tileset_filter = ${tilesetFilter}
    WHERE map_preferences.user_id = ${userId}
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return new MapPreferences(result.rows[0])
  } finally {
    done()
  }
}

export async function getMapPreferences(userId) {
  const query = SQL`
    SELECT *
    FROM map_preferences
    WHERE user_id = ${userId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? new MapPreferences(result.rows[0]) : null
  } finally {
    done()
  }
}
