import db from '../db'
import SQL from 'sql-template-strings'

class MapPool {
  constructor(props) {
    this.id = props.id
    this.type = props.matchmaking_type
    this.startDate = props.start_date
    this.maps = props.maps || []
  }
}

async function getMapPoolsCount(type) {
  const query = SQL`
    SELECT COUNT(id)
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

export async function getMapPoolHistory(matchmakingType, limit, pageNumber) {
  const query = SQL`
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
    const mapPools = result.rows.length > 0 ? result.rows.map(row => new MapPool(row)) : []
    return { mapPools, total }
  } finally {
    done()
  }
}

export async function addMapPool(matchmakingType, mapIds, startDate) {
  const query = SQL`
    INSERT INTO matchmaking_map_pools (matchmaking_type, start_date, maps)
    VALUES (${matchmakingType}, ${startDate}, ${mapIds})
    RETURNING *;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return new MapPool(result.rows[0])
  } finally {
    done()
  }
}

export async function getCurrentMapPool(matchmakingType) {
  const query = SQL`
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = ${matchmakingType} AND start_date <= ${new Date()}
    ORDER BY start_date DESC
    LIMIT 1;
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? new MapPool(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function getMapPoolById(mapPoolId) {
  const query = SQL`
    SELECT *
    FROM matchmaking_map_pools
    WHERE id = ${mapPoolId};
  `

  const { client, done } = await db()
  try {
    const result = await client.query(query)
    return result.rows.length > 0 ? new MapPool(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function removeMapPool(mapPoolId) {
  const query = SQL`
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
