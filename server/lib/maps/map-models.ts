import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  MapExtension,
  MapForce,
  MapInfo,
  MapSortType,
  MapStartLocation,
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
import { mapNameMatches } from './map-search'
import { imagePath, mapPath } from './paths'

type DbMapInfo = Dbify<{
  id: SbMapId
  hash: Buffer
  name: string
  description: string
  official: boolean
  listed: boolean
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
  startLocations: MapStartLocation[]
  umsContent: boolean | null
  parserVersion: number
  imageVersion: number
  renderVersion: number
}>

/** The columns of `maps` (aliased as `m`) that make up a `DbMapInfo`. */
const MAP_INFO_COLUMNS = sql`
  m.id,
  m.hash,
  m.name,
  COALESCE(m.public_description, m.description) AS description,
  m.official,
  m.listed,
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
  m.start_locations,
  m.ums_content,
  m.parser_version,
  m.image_version,
  m.render_version,
  m.lobby_init_data
`

interface MapUrlProps {
  mapUrl?: string
  image256Url?: string
  image512Url?: string
  image1024Url?: string
  image2048Url?: string
  jpegImageUrl?: string
}

/** Returns which listing a map appears in, given how the database records it. */
function toVisibility({ listed, official }: { listed: boolean; official: boolean }) {
  if (!listed) {
    return MapVisibility.Unlisted
  }
  return official ? MapVisibility.Official : MapVisibility.Public
}

function convertFromDb(props: DbMapInfo, urls: MapUrlProps): MapInfo {
  return {
    id: props.id,
    hash: props.hash.toString('hex'),
    name: props.name,
    description: props.description,
    // A delisted map keeps its publishing record, but only a listed map has a publisher
    publishedBy: props.listed ? (props.published_by ?? undefined) : undefined,
    publishedAt: props.listed ? (props.published_at ?? undefined) : undefined,
    visibility: toVisibility(props),
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
      startLocations: props.start_locations,
      umsContent: props.ums_content ?? undefined,
      parserVersion: props.parser_version,
    },
    imageVersion: props.image_version,
    imageSpawnsBaked: props.render_version === 0,
    ...urls,
  }
}

async function createMapInfo(info: DbMapInfo): Promise<MapInfo> {
  const hash = info.hash.toString('hex')
  const imageVersion = info.image_version
  const renderVersion = info.render_version
  const getImageUrl = (size: 256 | 512 | 1024 | 2048, format: 'avif' | 'jpg') => {
    const url = getUrl(imagePath({ hash, imageVersion, renderVersion, size, format }))
    // Images from before render versions are overwritten in place when re-rendered
    if (!url || renderVersion !== 0) {
      return url
    }
    return `${url}${url.includes('?') ? '&' : '?'}v=${imageVersion}`
  }

  return convertFromDb(info, {
    mapUrl: await getSignedUrl(mapPath(hash, info.extension)),
    image256Url: getImageUrl(256, 'avif'),
    image512Url: getImageUrl(512, 'avif'),
    image1024Url: getImageUrl(1024, 'avif'),
    image2048Url: getImageUrl(2048, 'avif'),
    jpegImageUrl: getImageUrl(1024, 'jpg'),
  })
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
    conditions.push(mapNameMatches(searchStr))
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

function getListingCondition(listing: MapVisibility): SqlTemplate {
  switch (listing) {
    case MapVisibility.Official:
      return sql`WHERE m.listed AND m.official`
    case MapVisibility.Public:
      return sql`WHERE m.listed AND NOT m.official`
    case MapVisibility.Unlisted:
      return sql`WHERE NOT m.listed`
    default:
      return assertUnreachable(listing)
  }
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
    conditions = [getListingCondition(source.listing)]
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
      delisted_by = ${delistedBy},
      delisted_at = CURRENT_TIMESTAMP
    WHERE id = ${mapId} AND listed;
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
    VALUES (${mapId}, ${userId}, CURRENT_TIMESTAMP)
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
        TRUNCATE matchmaking_map_pools, favorited_maps, map_favorite_counts, map_library,
          map_id_aliases, map_stats, map_stats_daily, map_matchup_stats, map_analysis,
          map_link_suggestions, map_family_members, map_families, map_parse_rejections,
          superseded_map_images, uploaded_maps_legacy, maps;
      COMMIT;
    `

    await client.query(query)
    await deleteFromStoreFn()
  })
}
