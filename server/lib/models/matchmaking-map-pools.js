import db from '../db'

export async function getMapPoolHistory(matchmakingType, limit, pageNumber) {
  const query = `
    SELECT start_date, maps
    FROM matchmaking_map_pools
    WHERE matchmaking_type = $1
    ORDER BY start_date
    LIMIT $2
    OFFSET $3
  `
  const params = [matchmakingType, limit, pageNumber * limit]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ?
        result.rows.map(row => ({
          startDate: row.start_date,
          maps: row.maps.map(map => map.toString('hex')),
        })) :
        null
  } finally {
    done()
  }
}

export async function addMapPool(matchmakingType, maps, startDate) {
  const query = `
    INSERT INTO matchmaking_map_pools (matchmaking_type, start_date, maps)
    VALUES ($1, $2, $3)
  `
  const mapsHashes = maps.map(m => Buffer.from(m, 'hex'))
  const params = [matchmakingType, startDate, mapsHashes]

  const { client, done } = await db()
  try {
    await client.query(query, params)
  } finally {
    done()
  }
}

export async function getCurrentMapPool(matchmakingType) {
  const query = `
    SELECT maps
    FROM matchmaking_map_pools
    WHERE matchmaking_type = $1
    ORDER BY start_date DESC
    LIMIT 1
  `
  const params = [matchmakingType]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? result.rows[0].maps.map(map => map.toString('hex')) : null
  } finally {
    done()
  }
}
