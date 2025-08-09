import { SbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { MatchmakingMapPool } from '../../../common/matchmaking/matchmaking-map-pools'
import db, { DbClient } from '../db'
import { sql } from '../db/sql'
import { Dbify } from '../db/types'

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
    const result = await client.query(sql`
      SELECT *
      FROM matchmaking_map_pools
      WHERE matchmaking_type = ${matchmakingType}
      ORDER BY start_date DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `)
    return result.rows.map(row => convertFromDb(row))
  } finally {
    done()
  }
}

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
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      INSERT INTO matchmaking_map_pools (matchmaking_type, start_date, maps, max_veto_count)
      VALUES (${matchmakingType}, ${startDate}, ${maps}, ${maxVetoCount})
      RETURNING *;
    `)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function getCurrentMapPool(
  matchmakingType: MatchmakingType,
  withClient?: DbClient,
): Promise<MatchmakingMapPool | null> {
  const { client, done } = await db(withClient)
  try {
    const result = await client.query<DbMatchmakingMapPool>(sql`
      SELECT *
      FROM matchmaking_map_pools
      WHERE matchmaking_type = ${matchmakingType} AND start_date <= ${new Date()}
      ORDER BY start_date DESC
      LIMIT 1;
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
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
      SELECT *
      FROM matchmaking_map_pools
      WHERE id = ${mapPoolId};
    `)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function removeMapPool(mapPoolId: number, withClient?: DbClient): Promise<void> {
  const { client, done } = await db(withClient)
  try {
    await client.query(sql`
      DELETE FROM matchmaking_map_pools
      WHERE id = ${mapPoolId};
    `)
  } finally {
    done()
  }
}
