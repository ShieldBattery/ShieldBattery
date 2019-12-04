import db from '../db'
import transact from '../db/transaction'
import { tilesetIdToName } from '../../../app/common/maps'
import { getUrl } from '../file-upload'
import { mapPath, imagePath } from '../maps/store'

// This model contains information from three separate tables (`maps`, `uploaded_maps` and `users`)
// and should always be fully constructed, so pieces of code that use it don't have to be defensive
// about which parts of the model are actually filled in.
class MapInfo {
  constructor(props) {
    this.id = props.id
    this.hash = props.map_hash
    this.name = props.name
    this.description = props.description
    this.uploadedBy = {
      id: props.uploaded_by,
      name: props.uploaded_by_name,
    }
    this.uploadDate = props.upload_date
    this.visibility = props.visibility
    // This is StarCraft-specific map data that we get from parsing the map file
    this.mapData = {
      format: props.extension,
      tileset: tilesetIdToName(props.tileset),
      originalName: props.original_name,
      originalDescription: props.original_description,
      slots: props.players_melee,
      umsSlots: props.players_ums,
      umsForces: props.lobby_init_data.forces,
      width: props.width,
      height: props.height,
    }
    this.isFavorited = !!props.favorited
    this.mapUrl = null
    this.imageUrl = null
  }
}

const createMapInfo = async info => {
  const map = new MapInfo(info)
  const hashString = map.hash.toString('hex')

  map.hash = hashString
  map.mapUrl = await getUrl(mapPath(hashString, map.mapData.format))
  map.imageUrl = await getUrl(imagePath(hashString))

  return map
}

// transactionFn is a function() => Promise, which will be awaited inside the DB transaction. If it
// is rejected, the transaction will be rolled back.
export async function addMap(mapParams, transactionFn) {
  return await transact(async client => {
    const { mapData, extension, uploadedBy, visibility } = mapParams
    const {
      hash,
      title,
      description,
      width,
      height,
      tileset,
      meleePlayers,
      umsPlayers,
      lobbyInitData,
    } = mapData

    const exists = await mapExists(hash)
    if (!exists) {
      const query = `
        INSERT INTO maps (hash, extension, title, description, width, height, tileset,
          players_melee, players_ums, lobby_init_data)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
      `
      const params = [
        Buffer.from(hash, 'hex'),
        extension,
        title,
        description,
        width,
        height,
        tileset,
        meleePlayers,
        umsPlayers,
        lobbyInitData,
      ]
      // Run the `transactionFn` only if a new map is added
      await Promise.all([client.query(query, params), transactionFn()])
    }

    // Have to do this as a separate query because it's possible this query will do nothing (if the
    // uploaded map already exists), in which case we couldn't use `RETURNING` statement to do this
    // as a part of a sub-query.
    const insertQuery = `
      INSERT INTO uploaded_maps
        (id, map_hash, uploaded_by, upload_date, visibility, name, description)
      VALUES (uuid_generate_v4(), $1, $2, CURRENT_TIMESTAMP AT TIME ZONE 'UTC', $3, $4, $5)
      ON CONFLICT (map_hash, uploaded_by)
      DO NOTHING;
    `
    let params = [Buffer.from(hash, 'hex'), uploadedBy, visibility, title, description]
    await client.query(insertQuery, params)

    const query = `
      SELECT
        um.*,
        m.*,
        m.title AS original_name,
        m.description AS original_description,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      WHERE um.map_hash = $1 AND um.uploaded_by = $2;
    `
    params = [Buffer.from(hash, 'hex'), uploadedBy]

    const result = await client.query(query, params)
    return createMapInfo(result.rows[0])
  })
}

export async function mapExists(hash) {
  const query = `
    SELECT 1
    FROM maps
    WHERE hash = $1;
  `
  const params = [Buffer.from(hash, 'hex')]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0
  } finally {
    done()
  }
}

export async function getMapInfo(mapIds, userId) {
  const query = `
    WITH maps AS (
      SELECT
        um.*,
        m.*,
        m.title AS original_name,
        m.description AS original_description,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      WHERE um.id = ANY($1)
    )
    SELECT maps.*, fav.map_id AS favorited
    FROM maps LEFT JOIN favorited_maps AS fav
    ON fav.map_id = maps.id AND fav.favorited_by = $2;
  `
  const params = [mapIds, userId]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)

    if (result.rows.length < 1) return []

    const getInfo = mapId => result.rows.find(m => m.id === mapId)
    // Filter out the non-existing maps and preserve the order of the input array
    return Promise.all(mapIds.filter(getInfo).map(id => createMapInfo(getInfo(id))))
  } finally {
    done()
  }
}

async function getMapsCount(whereCondition, params) {
  const query = `
    SELECT COUNT(id)
    FROM uploaded_maps
    ${whereCondition};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return parseInt(result.rows[0].count, 10)
  } finally {
    done()
  }
}

export async function getMaps(
  visibilityArray,
  limit,
  pageNumber,
  favoritedBy,
  uploadedBy,
  searchStr,
) {
  let whereCondition = 'WHERE visibility = ANY($1)'
  const params = [visibilityArray]

  if (uploadedBy) {
    whereCondition += ` AND uploaded_by = $${params.length + 1}`
    params.push(uploadedBy)
  }

  if (searchStr) {
    whereCondition += ` AND um.name ILIKE $${params.length + 1}`
    const escapedStr = searchStr.replace(/[_%\\]/g, '\\$&')
    params.push(`%${escapedStr}%`)
  }

  const query = `
    WITH maps AS (
      SELECT
        um.*,
        m.*,
        m.title AS original_name,
        m.description AS original_description,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      ${whereCondition}
    )
    SELECT maps.*, fav.map_id AS favorited
    FROM maps LEFT JOIN favorited_maps AS fav
    ON fav.map_id = maps.id AND fav.favorited_by = $${params.length + 1}
    ORDER BY maps.name
    LIMIT $${params.length + 2}
    OFFSET $${params.length + 3};
  `
  const total = await getMapsCount(whereCondition, params)
  params.push(favoritedBy, limit, pageNumber * limit)

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    const maps = await Promise.all(result.rows.map(info => createMapInfo(info)))
    return { total, maps }
  } finally {
    done()
  }
}

export async function addMapToFavorites(mapId, userId) {
  const query = `
    INSERT INTO favorited_maps (map_id, favorited_by)
    VALUES ($1, $2)
    ON CONFLICT (map_id, favorited_by)
    DO NOTHING;
  `
  const params = [mapId, userId]

  const { client, done } = await db()
  try {
    await client.query(query, params)
  } finally {
    done()
  }
}

export async function removeMapToFavorites(mapId, userId) {
  const query = `
    DELETE FROM favorited_maps
    WHERE map_id = $1 AND favorited_by = $2;
  `
  const params = [mapId, userId]

  const { client, done } = await db()
  try {
    await client.query(query, params)
  } finally {
    done()
  }
}
