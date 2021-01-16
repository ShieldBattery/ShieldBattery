import sql from 'sql-template-strings'
import { MatchmakingType } from '../../../common/matchmaking'
import db from '../db'

interface DbMapPool {
  /* eslint-disable camelcase */
  id: string
  matchmaking_type: MatchmakingType
  start_date: Date
  maps: string[]
  /* eslint-enable camelcase */
}

export interface MapPool {
  id: string
  type: MatchmakingType
  startDate: Date
  maps: string[]
}

function convertFromDb(dbMapPool: DbMapPool): MapPool {
  /* eslint-disable camelcase */
  return {
    id: dbMapPool.id,
    type: dbMapPool.matchmaking_type,
    startDate: dbMapPool.start_date,
    maps: dbMapPool.maps,
  }
  /* eslint-enable camelcase */
}

async function getMapPoolsCount(type: MatchmakingType): Promise<number> {
  const query = sql`
    SELECT COUNT(*)
    FROM matchmaking_map_pools
    WHERE matchmaking_type = ${type};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return parseInt(result.rows[0].count, 10)
  } finally {
    done()
  }
}

export async function getMapPoolHistory(
  matchmakingType: MatchmakingType,
  limit: number,
  pageNumber: number,
): Promise<{ mapPools: MapPool[]; total: number }> {
  const query = sql`
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = ${matchmakingType}
    ORDER BY start_date DESC
    LIMIT ${limit}
    OFFSET ${pageNumber * limit};
  `

  const { client, done } = await db()
  try {
    const [total, result] = await Promise.all([
      getMapPoolsCount(matchmakingType),
      client.query(query),
    ])
    const mapPools = result.rows.length > 0 ? result.rows.map(row => convertFromDb(row)) : []
    return { mapPools, total }
  } finally {
    done()
  }
}

export async function addMapPool(
  matchmakingType: MatchmakingType,
  mapIds: string[],
  startDate: Date,
): Promise<MapPool> {
  const query = sql`
    INSERT INTO matchmaking_map_pools (matchmaking_type, start_date, maps)
    VALUES (${matchmakingType}, ${startDate}, ${mapIds})
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function getCurrentMapPool(matchmakingType: MatchmakingType): Promise<MapPool | null> {
  const query = sql`
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = ${matchmakingType} AND start_date <= ${new Date()}
    ORDER BY start_date DESC
    LIMIT 1;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function getMapPoolById(mapPoolId: number): Promise<MapPool | null> {
  const query = sql`
    SELECT *
    FROM matchmaking_map_pools
    WHERE id = ${mapPoolId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function removeMapPool(mapPoolId: number): Promise<void> {
  const query = sql`
    DELETE FROM matchmaking_map_pools
    WHERE id = ${mapPoolId};
  `

  const { client, done } = await db()
  try {
    await client.query(query)
  } finally {
    done()
  }
}
