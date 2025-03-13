import {
  MapExtension,
  MapFilters,
  MapForce,
  MapInfo,
  MapSortType,
  MapVisibility,
  Tileset,
} from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { SqlTemplate, sql, sqlConcat, sqlRaw } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { getSignedUrl, getUrl } from '../file-upload'
import { MapParseData } from './parse-data'
import { imagePath, mapPath } from './paths'

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
  isEud: boolean
  lobbyInitData: {
    forces: MapForce[]
  }
  width: number
  height: number
  parserVersion: number
  imageVersion: number
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
      isEud: props.is_eud,
      parserVersion: props.parser_version,
    },
    imageVersion: props.image_version,
    isFavorited: !!props.favorited,
    ...urls,
  }
}

function addImageVersion(url: string | undefined, imageVersion: number): string | undefined {
  if (!url) {
    return url
  } else if (url.includes('?')) {
    return `${url}&v=${imageVersion}`
  } else {
    return `${url}?v=${imageVersion}`
  }
}

async function createMapInfo(info: DbMapInfo): Promise<MapInfo> {
  const hashString = info.map_hash.toString('hex')

  const [mapUrl, image256Url, image512Url, image1024Url, image2048Url] = await Promise.all([
    getSignedUrl(mapPath(hashString, info.extension)),
    getUrl(imagePath(hashString, 256)),
    getUrl(imagePath(hashString, 512)),
    getUrl(imagePath(hashString, 1024)),
    getUrl(imagePath(hashString, 2048)),
  ])

  const imageVersion = info.image_version

  return convertFromDb(info, {
    mapUrl,
    image256Url: addImageVersion(image256Url, imageVersion),
    image512Url: addImageVersion(image512Url, imageVersion),
    image1024Url: addImageVersion(image1024Url, imageVersion),
    image2048Url: addImageVersion(image2048Url, imageVersion),
  })
}

export interface MapParams {
  mapData: MapParseData
  extension: MapExtension
  uploadedBy: number
  visibility: MapVisibility
  parserVersion: number
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
    const { mapData, extension, uploadedBy, visibility, parserVersion } = mapParams
    const {
      hash,
      title,
      description,
      width,
      height,
      tileset,
      meleePlayers,
      umsPlayers,
      isEud,
      lobbyInitData,
    } = mapData

    const hashBuffer = Buffer.from(hash, 'hex')
    const exists = await mapExists(hash)
    if (!exists) {
      const query = sql`
        INSERT INTO maps (hash, extension, title, description,
          width, height, tileset, players_melee, players_ums, lobby_init_data,
          is_eud, parser_version, image_version)
        VALUES (${hashBuffer}, ${extension}, ${title}, ${description},
          ${width}, ${height}, ${tileset}, ${meleePlayers}, ${umsPlayers}, ${lobbyInitData},
          ${isEud}, ${parserVersion}, 1);
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
        VALUES (sb_uuid(), ${hashBuffer}, ${uploadedBy},
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
        m.is_eud,
        m.parser_version,
        m.image_version,
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
 * Updates a maps' parsed data in the database, calling `parseFn` to retreieve the new data.
 *
 * @param oldMapInfos An array of maps to update (note that this will be their OLD info, before
 *   reparsing).
 * @param parseFn A function called once per map, returning a Promise with the parsed data. If the
 *   map couldn't be parsed (or doesn't need to be any more), returning an empty tuple will no-op
 *   the update.
 */
export async function updateParseData(
  oldMapInfos: MapInfo[],
  parseFn: (mapInfo: MapInfo) => Promise<[data: MapParseData, parserVersion: number] | []>,
): Promise<void> {
  const { client, done } = await db()
  try {
    await Promise.allSettled(
      oldMapInfos.map(async mapInfo => {
        const [newData, parserVersion] = await parseFn(mapInfo)
        if (newData && parserVersion !== undefined) {
          const hashBuffer = Buffer.from(mapInfo.hash, 'hex')
          await client.query<never>(sql`
            UPDATE maps
            SET
              title = ${newData.title},
              description = ${newData.description},
              width = ${newData.width},
              height = ${newData.height},
              tileset = ${newData.tileset},
              players_melee = ${newData.meleePlayers},
              players_ums = ${newData.umsPlayers},
              lobby_init_data = ${newData.lobbyInitData},
              is_eud = ${newData.isEud},
              parser_version = ${parserVersion}
            WHERE hash = ${hashBuffer}
          `)
        }
      }),
    )
  } finally {
    done()
  }
}

/**
 * Updates the map's generated images in the database, calling `storeImagesFn` to store them for
 * serving to clients.
 */
export async function updateMapImages(
  mapHash: string,
  storeImagesFn: () => Promise<void>,
): Promise<void> {
  return transact(async client => {
    const hashBuffer = Buffer.from(mapHash, 'hex')
    const queryPromise = client.query<never>(sql`
      UPDATE maps
      SET image_version = image_version + 1
      WHERE hash = ${hashBuffer}
    `)
    await Promise.all([queryPromise, storeImagesFn()])
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
        m.is_eud,
        m.parser_version,
        m.image_version,
        m.lobby_init_data,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      WHERE um.id = ANY(${mapIds})
    )
    ${favoritedJoin}
  `

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
async function getMapsCount(whereCondition: SqlTemplate): Promise<number> {
  const { client, done } = await db()
  try {
    const result = await client.query<{ count: string }>(sql`
      SELECT COUNT(*)
      FROM uploaded_maps AS um
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      ${whereCondition}
    `)

    return Number(result.rows[0].count)
  } finally {
    done()
  }
}

function getOrderByStatement(sort: MapSortType): SqlTemplate {
  const sortByArray = ['name']
  if (sort === MapSortType.NumberOfPlayers) {
    // TODO(tec27): Use players_melee if this is 0?
    sortByArray.unshift('players_ums')
  } else if (sort === MapSortType.Date) {
    sortByArray.unshift('upload_date DESC')
  }

  return sqlRaw(`ORDER BY ${sortByArray.join(', ')}`)
}

export async function getMaps(
  visibility: MapVisibility,
  sort: MapSortType,
  filters: Partial<MapFilters> = {},
  limit: number,
  pageNumber: number,
  favoritedBy?: SbUserId,
  uploadedBy?: SbUserId,
  searchStr?: string,
) {
  const conditions = [sql`WHERE removed_at IS NULL AND visibility = ${visibility}`]
  if (uploadedBy) {
    conditions.push(sql`uploaded_by = ${uploadedBy}`)
  }

  if (filters.numPlayers) {
    // Some maps (ICCup's Hannibal, for example) has players_ums = 0, which we don't allow filtering
    // on, so we use players_melee in that case
    conditions.push(sql`(
      players_ums = ANY(${filters.numPlayers}) OR
      players_ums = 0 AND players_melee = ANY(${filters.numPlayers})
    )`)
  }

  if (filters.tileset) {
    conditions.push(sql`tileset = ANY(${filters.tileset})`)
  }

  if (searchStr) {
    const escapedStr = `%${searchStr.replace(/[_%\\]/g, '\\$&')}%`
    conditions.push(sql`um.name ILIKE ${escapedStr}`)
  }

  const whereCondition = sqlConcat(' AND ', conditions)

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
        m.is_eud,
        m.parser_version,
        m.image_version,
        m.lobby_init_data,
        u.name AS uploaded_by_name
      FROM uploaded_maps AS um
      INNER JOIN users AS u
      ON um.uploaded_by = u.id
      INNER JOIN maps AS m
      ON um.map_hash = m.hash
      ${whereCondition}
    )
    SELECT maps.*, ${favoritedBy ? sql`fav.map_id AS favorited` : sql`FALSE AS favorited`}
    FROM maps ${
      favoritedBy
        ? sql`LEFT JOIN favorited_maps AS fav
          ON fav.map_id = maps.id AND fav.favorited_by = ${favoritedBy}
         `
        : sql``
    }
    ${orderByStatement}
    LIMIT ${limit}
    OFFSET ${pageNumber * limit};
  `

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
  const conditions = [sql`WHERE removed_at IS NULL AND favorited_by = ${favoritedBy}`]

  if (filters.numPlayers) {
    // Some maps (ICCup's Hannibal, for example) has players_ums = 0, which we don't allow filtering
    // on, so we use players_melee in that case
    conditions.push(sql`(
      players_ums = ANY(${filters.numPlayers}) OR
      players_ums = 0 AND players_melee = ANY(${filters.numPlayers})
    )`)
  }

  if (filters.tileset) {
    conditions.push(sql`tileset = ANY(${filters.tileset})`)
  }

  if (searchStr) {
    const escapedStr = `%${searchStr.replace(/[_%\\]/g, '\\$&')}%`
    conditions.push(sql`um.name ILIKE ${escapedStr}`)
  }

  const whereCondition = sqlConcat(' AND ', conditions)

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
      m.is_eud,
      m.parser_version,
      m.image_version,
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
    ${whereCondition}
    ${orderByStatement}
  `

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
  favoritedBy: SbUserId,
  name?: string,
  description?: string,
): Promise<MapInfo> {
  const updates = []

  if (name) {
    updates.push(sql`name = ${name}`)
  }
  if (description) {
    updates.push(sql`description = ${description}`)
  }

  const query = sql`
    WITH update AS (
      UPDATE uploaded_maps
      SET
      ${sqlConcat(', ', updates)}
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
      m.is_eud,
      m.parser_version,
      m.image_version,
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
  `

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
        UPDATE matchmaking_preferences SET map_selections = '{}';
        TRUNCATE matchmaking_map_pools, favorited_maps, uploaded_maps, maps;
      COMMIT;
    `

    await client.query(query)
    await deleteFromStoreFn()
  })
}
