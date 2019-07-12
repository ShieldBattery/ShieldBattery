import db from '../db'
import transact from '../db/transaction'
import { tilesetIdToName } from '../../../app/common/maps'
import { getUrl } from '../file-upload'
import { mapPath, imagePath } from '../maps/store'

class MapInfo {
  constructor(props) {
    this.hash = props.hash
    this.format = props.extension
    this.tileset = tilesetIdToName(props.tileset)
    this.name = props.title
    this.description = props.description
    this.slots = props.players_melee
    this.umsSlots = props.players_ums
    this.umsForces = props.lobby_init_data.forces
    this.width = props.width
    this.height = props.height
    this.mapUrl = null
    this.imageUrl = null
  }
}

const createMapInfo = async info => {
  const map = new MapInfo(info)

  return {
    ...map,
    mapUrl: await getUrl(mapPath(map.hash, map.format)),
    imageUrl: await getUrl(imagePath(map.hash)),
  }
}

// transactionFn is a function() => Promise, which will be awaited inside the DB transaction. If it
// is rejected, the transaction will be rolled back.
export async function addMap(mapData, extension, filename, modifiedDate, transactionFn) {
  return await transact(async client => {
    const query = `
      INSERT INTO maps
      (hash, extension, filename, title, description, width, height, tileset,
      players_melee, players_ums, upload_time, modified_time, lobby_init_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `
    const {
      hash,
      title,
      description,
      width,
      height,
      tileset,
      meleePlayers,
      umsPlayers,
      lobbyInitData,
    } = mapData
    const params = [
      Buffer.from(hash, 'hex'),
      extension,
      filename,
      title,
      description,
      width,
      height,
      tileset,
      meleePlayers,
      umsPlayers,
      new Date(),
      modifiedDate,
      lobbyInitData,
    ]

    const [result] = await Promise.all([client.query(query, params), transactionFn()])

    return createMapInfo(result.rows[0])
  })
}

export async function getMapInfo(...hashes) {
  const query = `
    SELECT *
    FROM maps
    WHERE hash IN $1
  `
  // TODO(2Pac): Do we need to escape hashes here?
  const params = [hashes.map(s => '\\x' + s)]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? result.rows.map(createMapInfo) : []
  } finally {
    done()
  }
}

export async function listMaps(limit, pageNumber, searchStr) {
  const whereClause = searchStr ? 'WHERE title ILIKE $3' : ''
  const query = `
    SELECT *
    FROM maps
    ${whereClause}
    LIMIT $1
    OFFSET $2
  `
  const escapedStr = searchStr.replace(/[_%\\]/g, '\\$&')
  const params = [limit, pageNumber]
  if (searchStr) {
    params.push(`%${escapedStr}%`)
  }

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? result.rows.map(createMapInfo) : []
  } finally {
    done()
  }
}
