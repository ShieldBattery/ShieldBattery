import sql, { SQLStatement } from 'sql-template-strings'
import {
  MapExtension,
  MapFilters,
  MapForce,
  MapInfo,
  MapSortType,
  MapVisibility,
  Tileset,
} from '../../../common/maps'
import { SbUserId } from '../../../common/users/user-info'
import db from '../db'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { getUrl } from '../file-upload'
import { MapParseData } from './parse-data'
import { imagePath, mapPath } from './store'

// TODO(tec27): Make the MapInfo structure more closely align to what we store here?
type DbMapInfo = Dbify<{
  id: string
  mapHash: Buffer
  name: string
  description: string
  uploadedBy: number
  uploadedByName: string
  uploadDate: Date
  visibility: MapVisibility
  extension: MapExtension
  tileset: Tileset
  originalName: string
  originalDescription: string
  playersMelee: number
  playersUms: number
  lobbyInitData: {
    forces: MapForce[]
  }
  width: number
  height: number
  favorited?: boolean
}>

interface MapUrlProps {
  mapUrl?: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
}

function convertFromDb(props: DbMapInfo, urls: MapUrlProps): MapInfo {
  return {
    id: props.id,
    hash: props.map_hash.toString('hex'),
    name: props.name,
    description: props.description,
    uploadedBy: {
      id: props.uploaded_by,
      name: props.uploaded_by_name,
    },
    uploadDate: props.upload_date,
    visibility: props.visibility,
    mapData: {
      format: props.extension,
      tileset: props.tileset,
      originalName: props.original_name,
      originalDescription: props.original_description,
      slots: props.players_melee,
      umsSlots: props.players_ums,
      umsForces: props.lobby_init_data.forces,
      width: props.width,
      height: props.height,
    },
    isFavorited: !!props.favorited,
    ...urls,
  }
}

const createMapInfo = async (info: DbMapInfo) => {
  const hashString = info.map_hash.toString('hex')

  const [mapUrl, image256Url, image512Url, image1024Url, image2048Url] = await Promise.all([
    getUrl(mapPath(hashString, info.extension), true),
    getUrl(imagePath(hashString, 256)),
    getUrl(imagePath(hashString, 512)),
    getUrl(imagePath(hashString, 1024)),
    getUrl(imagePath(hashString, 2048)),
  ])

  return convertFromDb(info, {
    mapUrl,
    image256Url,
    image512Url,
    image1024Url,
    image2048Url,
  })
}

export interface MapParams {
  mapData: MapParseData
  extension: MapExtension
  uploadedBy: number
  visibility: MapVisibility
}

/**
 * Adds a map to the database.
 *
 * @param mapParams Information about the map (should be parsed from the map file)
 * @param storeNewMapFn A function that should store the relevant map data/images if this is a
 *   new map. This will be called during the DB transaction, if it fails then the transaction will
 *   be rolled back. It will not be called if this map already exists in the DB
 */
export async function addMap(
  mapParams: MapParams,
  storeNewMapFn: () => Promise<void>,
): Promise<MapInfo> {
  return transact(async client => {
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

    const hashBuffer = Buffer.from(hash, 'hex')
    const exists = await mapExists(hash)
    if (!exists) {
      const query = sql`
        INSERT INTO maps (hash, extension, title, description,
          width, height, tileset, players_melee, players_ums, lobby_init_data)
        VALUES (${hashBuffer}, ${extension}, ${title}, ${description},
          ${width}, ${height}, ${tileset}, ${meleePlayers}, ${umsPlayers}, ${lobbyInitData});
      `
      await client.query(query)
      // Run the `transactionFn` only if a new map is added
      await storeNewMapFn()
    }

    const query = sql`
      WITH ins AS (
        INSERT INTO uploaded_maps AS um
          (id, map_hash, uploaded_by,
            upload_date, visibility, name, description)
        VALUES (uuid_generate_v4(), ${hashBuffer}, ${uploadedBy},
          CURRENT_TIMESTAMP AT TIME ZONE 'UTC', ${visibility}, ${title}, ${description})
        ON CONFLICT (map_hash, uploaded_by, visibility)
        DO UPDATE
        SET
          removed_at = NULL,
          upload_date = CURRENT_TIMESTAMP AT TIME ZONE 'UTC',
          visibility = ${visibility},
          name = ${title},
          description = ${description}
        WHERE um.map_hash = ${hashBuffer} AND
          um.uploaded_by = ${uploadedBy} AND
          um.visibility = ${visibility}
        RETURNING *
      )
      SELECT
        ins.*,
        m.extension,
        m.title AS original_name,
        m.description AS original_description,
        m.width,
        m.height,
        m.tileset,
        m.players_melee,
        m.players_ums,
        m.lobby_init_data,
        u.name AS uploaded_by_name
      FROM ins
      INNER JOIN users AS u
      ON ins.uploaded_by = u.id
      INNER JOIN maps AS m
      ON ins.map_hash = m.hash;
    `

    const result = await client.query<DbMapInfo>(query)
    return createMapInfo(result.rows[0])
  })
}

/**
 * Returns whether or not a map matching the specified hash exists. This can generally be used as
 * an indicator that the map file has already been stored on our servers, but is not an indication
 * that there is any map visible in the listing for a given user (e.g. it may be private, or may
 * have been deleted by whatever user uploaded it).
 */
export async function mapExists(hash: string) {
  const { client, done } = await db()
  try {
    const result = await client.query(sql`
      SELECT 1
      FROM maps
      WHERE hash = ${Buffer.from(hash, 'hex')};
    `)
    return result.rows.length > 0
  } finally {
    done()
  }
}

/**
 * Retrieves information for the specified maps
 *
 * @param mapIds an array of map IDs to retrieve info for
 * @param favoritedBy A user to retrieve "favorite" map information relative to (optional, if not
 *   specified, favorited status will not be included)
 *
 * @returns a Promise for an array of `MapInfo`s, ordered in the way they were passed. If a
 *   specified map ID could not be found, it will not be included in the result
 */
export async function getMapInfo(mapIds: string[], favoritedBy?: SbUserId): Promise<MapInfo[]> {
  const favoritedJoin = favoritedBy
    ? sql`
      SELECT maps.*, fav.map_id AS favorited
      FROM maps LEFT JOIN favorited_maps AS fav
      ON fav.map_id = maps.id AND fav.favorited_by = ${favoritedBy};
    `
    : sql`
      SELECT maps.*
      FROM maps;
    `
  const query = sql`
    WITH maps AS (
      SELECT
        um.*,
        m.extension,
        m.title AS original_name,
        m.description AS original_description,
        m.width,
        m.height,
        m.tileset,
        m.players_melee,
        m.players_ums,
        m.lobby_init_data,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      WHERE um.id = ANY(${mapIds})
    )
  `.append(favoritedJoin)

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)

    if (result.rows.length < 1) return []

    const mapInfos = await Promise.all(result.rows.map(d => createMapInfo(d)))
    const idToMapInfo = new Map<string, MapInfo>()
    for (const mapInfo of mapInfos) {
      idToMapInfo.set(mapInfo.id, mapInfo)
    }

    const orderedMapInfos = []
    for (const id of mapIds) {
      const info = idToMapInfo.get(id)
      if (info) {
        orderedMapInfos.push(info)
      }
    }

    return orderedMapInfos
  } finally {
    done()
  }
}

/** Returns the number of maps that match a particular condition. */
async function getMapsCount(whereCondition: SQLStatement): Promise<number> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ count: string }>(
      sql`
      SELECT COUNT(*)
      FROM uploaded_maps AS um
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
    `.append(whereCondition),
    )

    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

function getOrderByStatement(sort: MapSortType): string {
  const sortByArray = ['name']
  if (sort === MapSortType.NumberOfPlayers) {
    sortByArray.unshift('players_ums')
  } else if (sort === MapSortType.Date) {
    sortByArray.unshift('upload_date DESC')
  }

  return `ORDER BY ${sortByArray.join(', ')}`
}

export async function getMaps(
  visibility: MapVisibility,
  sort: MapSortType,
  filters: Partial<MapFilters> = {},
  limit: number,
  pageNumber: number,
  favoritedBy: number,
  uploadedBy?: number,
  searchStr?: string,
) {
  const whereCondition = sql`WHERE removed_at IS NULL AND visibility = ${visibility}`

  if (uploadedBy) {
    whereCondition.append(sql` AND uploaded_by = ${uploadedBy}`)
  }

  if (filters.numPlayers) {
    whereCondition.append(sql` AND players_ums = ANY(${filters.numPlayers})`)
  }

  if (filters.tileset) {
    whereCondition.append(sql` AND tileset = ANY(${filters.tileset})`)
  }

  if (searchStr) {
    const escapedStr = `%${searchStr.replace(/[_%\\]/g, '\\$&')}%`
    whereCondition.append(sql` AND um.name ILIKE ${escapedStr}`)
  }

  const totalPromise = getMapsCount(whereCondition)

  const orderByStatement = getOrderByStatement(sort)
  const query = sql`
    WITH maps AS (
      SELECT
        um.*,
        m.extension,
        m.title AS original_name,
        m.description AS original_description,
        m.width,
        m.height,
        m.tileset,
        m.players_melee,
        m.players_ums,
        m.lobby_init_data,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
    `
    .append(whereCondition)
    .append(
      sql`
    )
    SELECT maps.*, fav.map_id AS favorited
    FROM maps LEFT JOIN favorited_maps AS fav
    ON fav.map_id = maps.id AND fav.favorited_by = ${favoritedBy}
    `,
    )
    .append(orderByStatement).append(sql`
    LIMIT ${limit}
    OFFSET ${pageNumber * limit};
  `)

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)
    const maps = await Promise.all(result.rows.map(info => createMapInfo(info)))
    const total = await totalPromise
    return { total, maps }
  } finally {
    done()
  }
}

// TODO(2Pac): If it becomes a problem, add paging to this
/**
 * Retrieves the list of favorited maps for a user.
 */
export async function getFavoritedMaps(
  favoritedBy: number,
  sort: MapSortType,
  filters: Partial<MapFilters> = {},
  searchStr?: string,
): Promise<MapInfo[]> {
  const whereCondition = sql`WHERE removed_at IS NULL AND favorited_by = ${favoritedBy}`

  if (filters.numPlayers) {
    whereCondition.append(sql` AND players_ums = ANY(${filters.numPlayers})`)
  }

  if (filters.tileset) {
    whereCondition.append(sql` AND tileset = ANY(${filters.tileset})`)
  }

  if (searchStr) {
    const escapedStr = `%${searchStr.replace(/[_%\\]/g, '\\$&')}%`
    whereCondition.append(sql` AND um.name ILIKE ${escapedStr}`)
  }

  const orderByStatement = getOrderByStatement(sort)
  const query = sql`
    SELECT
      um.*,
      m.extension,
      m.title AS original_name,
      m.description AS original_description,
      m.width,
      m.height,
      m.tileset,
      m.players_melee,
      m.players_ums,
      m.lobby_init_data,
      u.name AS uploaded_by_name,
      true AS favorited
    FROM favorited_maps AS fm
    INNER JOIN uploaded_maps AS um
    ON fm.map_id = um.id
    INNER JOIN users AS u
    ON um.uploaded_by = u.id
    INNER JOIN maps AS m
    ON um.map_hash = m.hash
    `
    .append(whereCondition)
    .append(
      sql`
      `,
    )
    .append(orderByStatement)

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)
    // NOTE(tec27): no need to await this because it doesn't utilize the client
    return Promise.all(result.rows.map(info => createMapInfo(info)))
  } finally {
    done()
  }
}

/** Updates the name or description of an existing map. */
export async function updateMap(
  mapId: string,
  favoritedBy: number,
  name?: string,
  description?: string,
): Promise<MapInfo> {
  const setStatement = sql`SET`
  let appended = false

  if (name) {
    setStatement.append(sql` name = ${name}`)
    appended = true
  }
  if (description) {
    if (appended) {
      setStatement.append(sql`,`)
    }

    setStatement.append(sql` description = ${description}`)
    appended = true
  }

  const query = sql`
    WITH update AS (
      UPDATE uploaded_maps
      `.append(setStatement).append(sql`
      WHERE id = ${mapId}
      RETURNING *
    )
    SELECT
      um.*,
      m.extension,
      m.title AS original_name,
      m.description AS original_description,
      m.width,
      m.height,
      m.tileset,
      m.players_melee,
      m.players_ums,
      m.lobby_init_data,
      u.name AS uploaded_by_name,
      fav.map_id AS favorited
    FROM update AS um
    INNER JOIN users AS u
    ON um.uploaded_by = u.id
    INNER JOIN maps AS m
    ON um.map_hash = m.hash
    LEFT JOIN favorited_maps AS fav
    ON fav.map_id = um.id AND fav.favorited_by = ${favoritedBy}
  `)

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)
    return createMapInfo(result.rows[0])
  } finally {
    done()
  }
}

export async function removeMap(mapId: string): Promise<void> {
  const query = sql`
    UPDATE uploaded_maps
    SET removed_at = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
    WHERE id = ${mapId};
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}

export async function addMapToFavorites(mapId: string, userId: SbUserId): Promise<void> {
  const query = sql`
    INSERT INTO favorited_maps (map_id, favorited_by, favorited_date)
    VALUES (${mapId}, ${userId}, CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    ON CONFLICT (map_id, favorited_by)
    DO NOTHING;
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}

export async function removeMapFromFavorites(mapId: string, userId: SbUserId) {
  const query = sql`
    DELETE FROM favorited_maps
    WHERE map_id = ${mapId} AND favorited_by = ${userId};
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}

/**
 * Removes all maps in the database.
 *
 * This function should only be used by users with necessary, super-restrictive, permissions. Note
 * that unlike the user-facing "removeMap" function, which soft-deletes a map, this one actually
 * deletes all maps from the database. Use with care!
 *
 * @param deleteFromStoreFn A function that will be called during the database transaction that
 *   should delete the map contents from the file store as well. If this function fails, the
 *   transaction will be rolled back
 */
export async function veryDangerousDeleteAllMaps(deleteFromStoreFn: () => Promise<void>) {
  return transact(async client => {
    const query = sql`
      BEGIN;
        UPDATE lobby_preferences SET recent_maps = NULL, selected_map = NULL;
        UPDATE matchmaking_preferences SET map_selections = NULL;
        TRUNCATE matchmaking_map_pools, favorited_maps, uploaded_maps, maps;
      COMMIT;
    `

    await client.query(query)
    await deleteFromStoreFn()
  })
}
