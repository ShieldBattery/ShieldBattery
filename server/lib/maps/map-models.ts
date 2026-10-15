import {
  MapExtension,
  MapForce,
  MapInfo,
  MapSortType,
  MapVisibility,
  NumPlayers,
  SbMapId,
  Tileset,
} from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import db from '../db'
import { sql, sqlConcat, sqlRaw, SqlTemplate } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { getSignedUrl, getUrl } from '../files'
import { MapParseData } from './parse-data'
import { imagePath, mapPath } from './paths'

type DbMapInfo = Dbify<{
  id: SbMapId
  hash: Buffer
  name: string
  description: string
  listing: MapVisibility
  publishedBy: SbUserId | null
  publishedAt: Date | null
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
}>

/** The columns of `maps` (aliased as `m`) that make up a `DbMapInfo`. */
const MAP_INFO_COLUMNS = sql`
  m.id,
  m.hash,
  m.name,
  COALESCE(m.public_description, m.description) AS description,
  m.listing,
  m.published_by,
  m.published_at,
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
  m.lobby_init_data
`

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
    hash: props.hash.toString('hex'),
    name: props.name,
    description: props.description,
    // A delisted map keeps its publishing record, but only a listed map has a publisher
    publishedBy:
      props.listing !== MapVisibility.Unlisted ? (props.published_by ?? undefined) : undefined,
    publishedAt:
      props.listing !== MapVisibility.Unlisted ? (props.published_at ?? undefined) : undefined,
    visibility: props.listing,
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
  const hashString = info.hash.toString('hex')

  const mapUrl = await getSignedUrl(mapPath(hashString, info.extension))
  const image256Url = getUrl(imagePath(hashString, 256))
  const image512Url = getUrl(imagePath(hashString, 512))
  const image1024Url = getUrl(imagePath(hashString, 1024))
  const image2048Url = getUrl(imagePath(hashString, 2048))

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
  uploadedBy: SbUserId
  visibility: MapVisibility
  parserVersion: number
}

/**
 * Adds a map to the database. An unlisted upload adds the map to the uploader's own maps; a listed
 * upload lists the map (if it isn't already listed at least that widely).
 *
 * @param mapParams Information about the map (should be parsed from the map file)
 * @param storeNewMapFn A function that should store the relevant map data/images if this is a
 *   new map. It is called before any rows are written, so that a `maps` row never refers to files
 *   that failed to store; if it rejects, nothing is written to the DB. It will not be called if
 *   this map already exists in the DB
 */
export async function addMap(
  mapParams: MapParams,
  storeNewMapFn: () => Promise<void>,
): Promise<MapInfo> {
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
  // Stored files are keyed by the map hash, so storing them before the `maps` row exists is safe:
  // the contents are identical for any given hash, and files with no row are inert (they're only
  // ever reached through a row). Two concurrent uploads of the same new map both store the same
  // bytes, and the loser of the `maps` insert fails its request, as it would have anyway.
  const exists = await mapExists(hash)
  if (!exists) {
    await storeNewMapFn()
  }

  return transact(async client => {
    if (!exists) {
      await client.query(sql`
        INSERT INTO maps (hash, extension, title, description,
          width, height, tileset, players_melee, players_ums, lobby_init_data,
          is_eud, parser_version, image_version)
        VALUES (${hashBuffer}, ${extension}, ${title}, ${description},
          ${width}, ${height}, ${tileset}, ${meleePlayers}, ${umsPlayers}, ${lobbyInitData},
          ${isEud}, ${parserVersion}, 1);
      `)
    }

    if (visibility === MapVisibility.Unlisted) {
      // Re-uploading a map that's already in the user's maps moves it to the top of the date sort
      await client.query(sql`
        INSERT INTO map_library (user_id, map_id, added_at)
        SELECT ${uploadedBy}, id, CURRENT_TIMESTAMP
        FROM maps
        WHERE hash = ${hashBuffer}
        ON CONFLICT (user_id, map_id)
        DO UPDATE SET added_at = CURRENT_TIMESTAMP
      `)
    } else {
      const widerListings =
        visibility === MapVisibility.Official
          ? [MapVisibility.Unlisted, MapVisibility.Public]
          : [MapVisibility.Unlisted]
      await client.query(sql`
        UPDATE maps
        SET
          listing = ${visibility},
          published_by = ${uploadedBy},
          published_at = CURRENT_TIMESTAMP,
          delisted_by = NULL,
          delisted_at = NULL
        WHERE hash = ${hashBuffer} AND listing = ANY(${widerListings})
      `)
    }

    const result = await client.query<DbMapInfo>(sql`
      SELECT ${MAP_INFO_COLUMNS}
      FROM maps AS m
      WHERE m.hash = ${hashBuffer}
    `)
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
  // The parses can be very slow (remote file retrieval + worker-thread parsing), so they all
  // complete before a DB client is acquired — holding a pooled connection idle across a whole
  // batch of parses can starve the pool under concurrent requests.
  const results = await Promise.allSettled(
    oldMapInfos.map(async mapInfo => {
      const [newData, parserVersion] = await parseFn(mapInfo)
      return { mapInfo, newData, parserVersion }
    }),
  )

  const updates: Array<{ mapInfo: MapInfo; newData: MapParseData; parserVersion: number }> = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { mapInfo, newData, parserVersion } = result.value
      if (newData && parserVersion !== undefined) {
        updates.push({ mapInfo, newData, parserVersion })
      }
    }
  }
  if (!updates.length) {
    return
  }

  const { client, done } = await db()
  try {
    for (const { mapInfo, newData, parserVersion } of updates) {
      const hashBuffer = Buffer.from(mapInfo.hash, 'hex')
      try {
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
      } catch {
        // A failed update just leaves that map on its old parser version, where it will be
        // retried the next time it's requested — same as a failed parse.
      }
    }
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
  // `image_version` is the cache-buster clients append to image URLs, so it can only be bumped
  // once the new images are actually in place. If storing them fails, clients keep using the
  // images that are still there, and the update can be retried.
  await storeImagesFn()

  const hashBuffer = Buffer.from(mapHash, 'hex')
  const { client, done } = await db()
  try {
    await client.query<never>(sql`
      UPDATE maps
      SET image_version = image_version + 1
      WHERE hash = ${hashBuffer}
    `)
  } finally {
    done()
  }
}

/**
 * Returns whether or not a map matching the specified hash exists. This can generally be used as
 * an indicator that the map file has already been stored on our servers, but is not an indication
 * that the map is visible in any listing (it may be unlisted, or in no user's maps at all).
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
 * @param mapIds an array of map IDs to retrieve info for. IDs that came from a client should go
 *   through `resolveMapIds` first
 *
 * @returns a Promise for an array of `MapInfo`s, ordered in the way they were passed. If a
 *   specified map ID could not be found, it will not be included in the result
 */
export async function getMapInfos(mapIds: ReadonlyArray<SbMapId>): Promise<MapInfo[]> {
  const query = sql`
    SELECT ${MAP_INFO_COLUMNS}
    FROM maps AS m
    WHERE m.id = ANY(${mapIds})
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)

    if (result.rows.length < 1) return []

    const mapInfos = await Promise.all(result.rows.map(d => createMapInfo(d)))
    const idToMapInfo = new Map<SbMapId, MapInfo>()
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

/**
 * Resolves map IDs to the IDs of their maps. Maps used to have one ID per upload of their file, and
 * clients that were running before that changed can still send those IDs, so this should be
 * applied to any map IDs received from a client before they're used. Order is preserved, and IDs
 * that don't resolve to anything are returned unchanged.
 */
export async function resolveMapIds(mapIds: ReadonlyArray<SbMapId>): Promise<SbMapId[]> {
  if (!mapIds.length) {
    return []
  }

  const { client, done } = await db()
  try {
    const result = await client.query<{ old_id: SbMapId; map_id: SbMapId }>(sql`
      SELECT old_id, map_id
      FROM map_id_aliases
      WHERE old_id = ANY(${mapIds})
    `)
    const aliases = new Map(result.rows.map(r => [r.old_id, r.map_id]))
    return mapIds.map(id => aliases.get(id) ?? id)
  } finally {
    done()
  }
}

/**
 * Resolves several lists of map IDs with a single query (see `resolveMapIds`), removing any
 * duplicates within each list that resolving produces.
 */
export async function resolveMapIdSets(
  lists: ReadonlyArray<ReadonlyArray<SbMapId>>,
): Promise<SbMapId[][]> {
  const resolved = await resolveMapIds(lists.flat())
  let start = 0
  return lists.map(list => {
    const ids = resolved.slice(start, start + list.length)
    start += list.length
    return Array.from(new Set(ids))
  })
}

/** Resolves a single map ID, see `resolveMapIds`. */
export async function resolveMapId(mapId: SbMapId): Promise<SbMapId> {
  return (await resolveMapIds([mapId]))[0]
}

function getWhereCondition(
  conditions: SqlTemplate[],
  numPlayers: NumPlayers[],
  tilesets: Tileset[],
  searchStr?: string,
): SqlTemplate {
  // Some maps (ICCup's Hannibal, for example) has players_ums = 0, which we don't allow filtering
  // on, so we use players_melee in that case
  conditions.push(sql`(
    m.players_ums = ANY(${numPlayers}) OR
    m.players_ums = 0 AND m.players_melee = ANY(${numPlayers})
  )`)

  conditions.push(sql`m.tileset = ANY(${tilesets})`)

  if (searchStr) {
    const escapedStr = `%${searchStr.replace(/[_%\\]/g, '\\$&')}%`
    conditions.push(sql`m.name ILIKE ${escapedStr}`)
  }

  return sqlConcat(' AND ', conditions)
}

/**
 * Returns the ORDER BY for a map listing. Listing queries select the date that their "Date" sort
 * uses as `sort_date`.
 */
function getOrderByStatement(sort: MapSortType): SqlTemplate {
  const sortByArray = ['name']
  if (sort === MapSortType.NumberOfPlayers) {
    // TODO(tec27): Use players_melee if this is 0?
    sortByArray.unshift('players_ums')
  } else if (sort === MapSortType.Date) {
    sortByArray.unshift('sort_date DESC NULLS LAST')
  }

  return sqlRaw(`ORDER BY ${sortByArray.join(', ')}`)
}

/** Where a map listing gets its maps from: a listing, or a user's own maps. */
export type MapListSource = { listing: MapVisibility } | { libraryOf: SbUserId }

export async function getMaps({
  source,
  sort,
  numPlayers,
  tilesets,
  searchStr,
  limit,
  offset = 0,
}: {
  source: MapListSource
  sort: MapSortType
  numPlayers: NumPlayers[]
  tilesets: Tileset[]
  searchStr?: string
  limit: number
  offset?: number
}): Promise<MapInfo[]> {
  let from: SqlTemplate
  let sortDate: SqlTemplate
  let conditions: SqlTemplate[]
  if ('libraryOf' in source) {
    from = sql`maps AS m INNER JOIN map_library AS l ON l.map_id = m.id`
    sortDate = sql`l.added_at`
    conditions = [sql`WHERE l.user_id = ${source.libraryOf}`]
  } else {
    from = sql`maps AS m`
    sortDate = sql`m.published_at`
    conditions = [sql`WHERE m.listing = ${source.listing}`]
  }

  const whereCondition = getWhereCondition(conditions, numPlayers, tilesets, searchStr)
  const orderByStatement = getOrderByStatement(sort)

  const query = sql`
    WITH listed AS (
      SELECT ${MAP_INFO_COLUMNS}, ${sortDate} AS sort_date
      FROM ${from}
      ${whereCondition}
    )
    SELECT *
    FROM listed
    ${orderByStatement}
    LIMIT ${limit}
    OFFSET ${offset};
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

/**
 * Retrieves the list of favorited maps for a user. Favorites are kept regardless of whether the map
 * is listed or in the user's own maps.
 */
export async function getFavoritedMaps({
  favoritedBy,
  sort,
  numPlayers,
  tilesets,
  searchStr,
}: {
  favoritedBy: SbUserId
  sort: MapSortType
  numPlayers: NumPlayers[]
  tilesets: Tileset[]
  searchStr?: string
}): Promise<MapInfo[]> {
  const conditions = [sql`WHERE fm.favorited_by = ${favoritedBy}`]

  const whereCondition = getWhereCondition(conditions, numPlayers, tilesets, searchStr)
  const orderByStatement = getOrderByStatement(sort)

  const query = sql`
    WITH favorited AS (
      SELECT ${MAP_INFO_COLUMNS}, fm.favorited_date AS sort_date
      FROM favorited_maps AS fm
      INNER JOIN maps AS m
      ON fm.map_id = m.id
      ${whereCondition}
    )
    SELECT *
    FROM favorited
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

/**
 * Takes in a list of map IDs and returns only those that are favorited by a particular user.
 */
export async function getFavoritedFromMapIds(
  favoritedBy: SbUserId,
  mapIds: ReadonlyArray<SbMapId>,
): Promise<SbMapId[]> {
  const query = sql`
    SELECT map_id
    FROM favorited_maps
    WHERE favorited_by = ${favoritedBy} AND map_id = ANY(${mapIds})
  `

  const { client, done } = await db()
  try {
    const result = await client.query<{ map_id: SbMapId }>(query)
    return result.rows.map(row => row.map_id)
  } finally {
    done()
  }
}

/**
 * Takes in a list of map IDs and returns only those that are in a particular user's own maps.
 */
export async function getLibraryFromMapIds(
  userId: SbUserId,
  mapIds: ReadonlyArray<SbMapId>,
): Promise<SbMapId[]> {
  if (!mapIds.length) {
    return []
  }

  const query = sql`
    SELECT map_id
    FROM map_library
    WHERE user_id = ${userId} AND map_id = ANY(${mapIds})
  `

  const { client, done } = await db()
  try {
    const result = await client.query<{ map_id: SbMapId }>(query)
    return result.rows.map(row => row.map_id)
  } finally {
    done()
  }
}

/**
 * Updates the curated name or description of a map. Throws an error if there are no updates, so
 * make sure to only call this method when you update one of the map's fields.
 */
export async function updateMap(
  mapId: SbMapId,
  name?: string,
  description?: string,
): Promise<MapInfo> {
  const updates = []

  if (name) {
    updates.push(sql`public_name = ${name}`)
  }
  if (description) {
    updates.push(sql`public_description = ${description}`)
  }

  if (!updates.length) {
    throw new Error('No columns updated')
  }

  const query = sql`
    WITH updated AS (
      UPDATE maps
      SET
      ${sqlConcat(', ', updates)}
      WHERE id = ${mapId}
      RETURNING *
    )
    SELECT ${MAP_INFO_COLUMNS}
    FROM updated AS m
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbMapInfo>(query)
    return createMapInfo(result.rows[0])
  } finally {
    done()
  }
}

/** Removes a map from a user's own maps. Returns whether it was in them. */
export async function removeMapFromLibrary(mapId: SbMapId, userId: SbUserId): Promise<boolean> {
  const query = sql`
    DELETE FROM map_library
    WHERE map_id = ${mapId} AND user_id = ${userId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return (result.rowCount ?? 0) > 0
  } finally {
    done()
  }
}

/**
 * Removes a map from the listings. It stays reachable by ID, so games, matchmaking pools,
 * favorites, and users' own maps keep working, and it keeps its curated name and the record of who
 * published it.
 */
export async function delistMap(mapId: SbMapId, delistedBy: SbUserId): Promise<void> {
  const query = sql`
    UPDATE maps
    SET
      listing = ${MapVisibility.Unlisted},
      delisted_by = ${delistedBy},
      delisted_at = CURRENT_TIMESTAMP
    WHERE id = ${mapId} AND listing <> ${MapVisibility.Unlisted};
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}

export async function addMapToFavorites(mapId: SbMapId, userId: SbUserId): Promise<void> {
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

export async function removeMapFromFavorites(mapId: SbMapId, userId: SbUserId) {
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
 * that unlike the user-facing removal functions, which only take a map out of a user's maps or the
 * listings, this one actually deletes all maps from the database. Use with care!
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
        TRUNCATE matchmaking_map_pools, favorited_maps, map_library, map_id_aliases,
          uploaded_maps_legacy, maps;
      COMMIT;
    `

    await client.query(query)
    await deleteFromStoreFn()
  })
}
