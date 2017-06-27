import db from '../db'

class MapPool {
  constructor(props) {
    this.id = props.id
    this.type = props.matchmaking_type
    this.startDate = props.start_date
    this.maps = props.maps.map(m => m.toString('hex'))
  }
}

export async function getMapPoolHistory(matchmakingType, limit, pageNumber) {
  const query = `
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = $1
    ORDER BY start_date DESC
    LIMIT $2
    OFFSET $3
  `
  const params = [matchmakingType, limit, pageNumber * limit]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? result.rows.map(row => new MapPool(row)) : []
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
    SELECT *
    FROM matchmaking_map_pools
    WHERE matchmaking_type = $1 AND start_date <= $2
    ORDER BY start_date DESC
    LIMIT 1
  `
  const params = [matchmakingType, new Date()]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? new MapPool(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function getMapPoolById(mapPoolId) {
  const query = `
    SELECT *
    FROM matchmaking_map_pools
    WHERE id = $1
    LIMIT 1
  `
  const params = [mapPoolId]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? new MapPool(result.rows[0]) : null
  } finally {
    done()
  }
}

export async function removeMapPool(mapPoolId) {
  const query = `
    DELETE FROM matchmaking_map_pools
    WHERE id = $1
  `
  const params = [mapPoolId]

  const { client, done } = await db()
  try {
    await client.query(query, params)
  } finally {
    done()
  }
}
