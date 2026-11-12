import { MapCollectionId, SbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { MatchmakingMapPool } from '../../../common/matchmaking/matchmaking-map-pools'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import transact from '../db/transaction'
import { Dbify } from '../db/types'
import { createLadderPoolCollection, deleteCollection } from '../maps/map-collection-models'

type DbMatchmakingMapPool = Dbify<MatchmakingMapPool>

function convertFromDb(dbMapPool: DbMatchmakingMapPool): MatchmakingMapPool {
  return {
    id: dbMapPool.id,
    matchmakingType: dbMapPool.matchmaking_type,
    startDate: dbMapPool.start_date,
    maps: dbMapPool.maps,
    maxVetoCount: dbMapPool.max_veto_count,
  }
}

/**
 * The columns of a `DbMatchmakingMapPool`, read from `matchmaking_map_pools p`. A pool's maps are the
 * exact files its collection holds, in the pool's order.
 */
const POOL_COLUMNS = sql`
  p.id,
  p.matchmaking_type,
  p.start_date,
  p.max_veto_count,
  COALESCE(
    (
      SELECT array_agg(cm.map_id ORDER BY cm.position, cm.id)
      FROM collection_maps cm
      WHERE cm.collection_id = p.collection_id
    ),
    '{}'
  ) AS maps
`

/** Thrown when a new map pool names maps that don't exist or aren't listed. */
export class MapPoolMapsError extends Error {
  constructor(readonly mapIds: ReadonlyArray<SbMapId>) {
    super(`maps that don't exist or aren't published can't be in a map pool: ${mapIds.join(', ')}`)
    this.name = 'MapPoolMapsError'
  }
}

export async function getMapPoolHistory(
  {
    matchmakingType,
    limit,
    offset,
  }: {
    matchmakingType: MatchmakingType
    limit: number
    offset: number
  },
  withClient?: DbClient,
): Promise<MatchmakingMapPool[]> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      SELECT ${POOL_COLUMNS}
      FROM matchmaking_map_pools p
      WHERE p.matchmaking_type = ${matchmakingType}
      ORDER BY p.start_date DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

/**
 * Adds a map pool holding `maps` (exact files, in the given order; repeats are dropped), along with
 * its collection, in one transaction. Throws a `MapPoolMapsError` if any of the maps doesn't exist
 * or isn't listed. Pass `withClient` to run on a connection that is already in a transaction.
 */
export async function addMapPool(
  {
    matchmakingType,
    maps,
    maxVetoCount,
    startDate,
  }: {
    matchmakingType: MatchmakingType
    maps: ReadonlyArray<SbMapId>
    maxVetoCount: number
    startDate: Date
  },
  withClient?: DbClient,
): Promise<MatchmakingMapPool> {
  const add = async (client: DbClient) => {
    const mapIds = Array.from(new Set(maps))
    // Locking the files keeps them from being unpublished until the pool is committed, and waits
    // for an unpublish that's already under way (which checks the pools after locking the file).
    const found = await client.query<{ id: SbMapId; listed: boolean }>(sql`
      SELECT id, listed
      FROM maps
      WHERE id = ANY(${mapIds})
      FOR SHARE
    `)
    const usable = new Set(found.rows.filter(r => r.listed).map(r => r.id))
    const unusable = mapIds.filter(id => !usable.has(id))
    if (unusable.length) {
      throw new MapPoolMapsError(unusable)
    }

    const collectionId = await createLadderPoolCollection(client, {
      createdAt: startDate,
      mapIds,
    })
    const result = await client.query<DbMatchmakingMapPool>(sql`
      WITH p AS (
        INSERT INTO matchmaking_map_pools
          (matchmaking_type, start_date, max_veto_count, collection_id)
        VALUES (${matchmakingType}, ${startDate}, ${maxVetoCount}, ${collectionId})
        RETURNING *
      )
      SELECT ${POOL_COLUMNS}
      FROM p;
    `)
    return convertFromDb(result.rows[0])
  }

  return withClient ? add(withClient) : transact(add)
}

export async function getCurrentMapPool(
  matchmakingType: MatchmakingType,
  withClient?: DbClient,
): Promise<MatchmakingMapPool | null> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      SELECT ${POOL_COLUMNS}
      FROM matchmaking_map_pools p
      WHERE p.matchmaking_type = ${matchmakingType} AND p.start_date <= ${new Date()}
      ORDER BY p.start_date DESC
      LIMIT 1;
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

/**
 * Returns the currently active map pool for each of the given matchmaking types in a single query,
 * keyed by matchmaking type. Types with no active pool are absent from the result. Pass `withClient`
 * to run on an existing connection.
 */
export async function getCurrentMapPools(
  matchmakingTypes: ReadonlyArray<MatchmakingType>,
  withClient?: DbClient,
): Promise<Map<MatchmakingType, MatchmakingMapPool>> {
  if (!matchmakingTypes.length) {
    return new Map()
  }

  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      SELECT DISTINCT ON (p.matchmaking_type) ${POOL_COLUMNS}
      FROM matchmaking_map_pools p
      WHERE p.matchmaking_type = ANY(${matchmakingTypes}::matchmaking_type[])
        AND p.start_date <= ${new Date()}
      ORDER BY p.matchmaking_type, p.start_date DESC;
    `)
    return new Map(
      result.rows.map(row => {
        const mapPool = convertFromDb(row)
        return [mapPool.matchmakingType, mapPool]
      }),
    )
  } finally {
    done()
  }
}

/**
 * Returns the start date of the earliest map pool for `matchmakingType` that starts after `after`,
 * or `undefined` if none is scheduled.
 */
export async function getNextMapPoolStartDate(
  matchmakingType: MatchmakingType,
  after: Date,
  withClient?: DbClient,
): Promise<Date | undefined> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<{ start_date: Date }>(sql`
      SELECT start_date
      FROM matchmaking_map_pools
      WHERE matchmaking_type = ${matchmakingType} AND start_date > ${after}
      ORDER BY start_date ASC
      LIMIT 1;
    `)
    return result.rows.length > 0 ? result.rows[0].start_date : undefined
  } finally {
    done()
  }
}

export async function getMapPoolById(
  mapPoolId: number,
  withClient?: DbClient,
): Promise<MatchmakingMapPool | null> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      SELECT ${POOL_COLUMNS}
      FROM matchmaking_map_pools p
      WHERE p.id = ${mapPoolId};
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

/**
 * Removes a map pool along with its collection, in one transaction. Pass `withClient` to run on a
 * connection that is already in a transaction.
 */
export async function removeMapPool(mapPoolId: number, withClient?: DbClient): Promise<void> {
  const remove = async (client: DbClient) => {
    const result = await client.query<{ collection_id: MapCollectionId }>(sql`
      DELETE FROM matchmaking_map_pools
      WHERE id = ${mapPoolId}
      RETURNING collection_id;
    `)
    if (result.rows.length) {
      await deleteCollection(client, result.rows[0].collection_id)
    }
  }

  await (withClient ? remove(withClient) : transact(remove))
}
