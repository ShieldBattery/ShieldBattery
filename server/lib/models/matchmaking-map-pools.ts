import { MatchmakingMapPool, MatchmakingType } from '../../../common/matchmaking.js'
import db from '../db/index.js'
import { sql } from '../db/sql.js'
import { Dbify } from '../db/types.js'

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
): Promise<{ mapPools: MatchmakingMapPool[]; total: number }> {
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
  maxVetoCount: number,
  startDate: Date,
): Promise<MatchmakingMapPool> {
  const query = sql`
    INSERT INTO matchmaking_map_pools (matchmaking_type, start_date, maps, max_veto_count)
    VALUES (${matchmakingType}, ${startDate}, ${mapIds}, ${maxVetoCount})
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingMapPool>(query)
    return convertFromDb(result.rows[0])
  } finally {
    done()
  }
}

export async function getCurrentMapPool(
  matchmakingType: MatchmakingType,
): Promise<MatchmakingMapPool | null> {
  const query = sql`
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = ${matchmakingType} AND start_date <= ${new Date()}
    ORDER BY start_date DESC
    LIMIT 1;
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingMapPool>(query)
    return result.rows.length > 0 ? convertFromDb(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function getMapPoolById(mapPoolId: number): Promise<MatchmakingMapPool | null> {
  const query = sql`
    SELECT *
    FROM matchmaking_map_pools
    WHERE id = ${mapPoolId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query<DbMatchmakingMapPool>(query)
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
