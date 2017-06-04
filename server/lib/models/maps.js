import db from '../db'
import { tilesetIdToName } from '../../../app/common/maps'

class MapInfo {
  constructor(info) {
    this.format = info.extension
    this.tileset = tilesetIdToName(info.tileset)
    this.name = info.title
    this.description = info.description
    this.slots = info.players_melee
    this.umsSlots = info.players_ums
    this.umsForces = info.lobby_init_data.forces
    this.width = info.width
    this.height = info.height
  }
}

export async function addMap(hashStr, extension, filename, mapData, timestamp) {
  const { client, done } = await db()
  try {
    const query = 'INSERT INTO maps ' +
        '(hash, extension, filename, title, description, width, height, tileset, ' +
        'players_melee, players_ums, upload_time, modified_time, lobby_init_data) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)'
    const hash = Buffer.from(hashStr, 'hex')
    const {
      title,
      description,
      width,
      height,
      tileset,
      meleePlayers,
      umsPlayers,
      lobbyInitData,
    } = mapData
    // Filename is varchar(32)
    // The filename is meant to just be potentially useful information that would be otherwise
    // lost on uploads (maybe there's a reason to search by it?), bw doesn't accept filenames
    // longer than 32 chars anyways, so just cut it silently.
    const limitedFilename = filename.slice(0, 32)
    const params = [hash, extension, limitedFilename, title, description,
      width, height, tileset, meleePlayers, umsPlayers, new Date(), timestamp, lobbyInitData]
    await client.queryPromise(query, params)
  } finally {
    done()
  }
}

export async function mapExists(hashStr) {
  let hash
  try {
    hash = Buffer.from(hashStr, 'hex')
  } catch (e) {
    return false
  }
  const { client, done } = await db()
  try {
    const result = await client.queryPromise('SELECT 1 FROM maps WHERE hash = $1', [ hash ])
    return result.rows.length !== 0
  } finally {
    done()
  }
}

// Returns an array of map info objects, ordered in the same way as they were passed in.
// An array entry is null if a map doesn't exist in the db.
export async function mapInfo(...hashStr) {
  const hashes = hashStr.map(s => '\\x' + s)
  const { client, done } = await db()
  try {
    const query = 'SELECT hash, extension, title, description, width, height, players_melee, ' +
        'players_ums, tileset, lobby_init_data ' +
        'FROM maps WHERE hash = ANY($1)'
    const result = await client.queryPromise(query, [ hashes ])
    if (result.rows.length === 0) {
      return null
    } else {
      return hashStr.map(hash => {
        const info = result.rows.find(x => x.hash.toString('hex') === hash)
        return info ? new MapInfo(info) : null
      })
    }
  } finally {
    done()
  }
}

export async function searchMaps(searchStr) {
  const query = `
    SELECT hash, extension, title, description, width, height, tileset, players_melee, players_ums,
        lobby_init_data
    FROM maps
    WHERE title ILIKE $1
  `
  const escapedStr = searchStr.replace(/_/g, '\_').replace(/%/g, '\%')
  const params = [`%${escapedStr}%`]

  const { client, done } = await db()
  try {
    const result = await client.query(query, params)
    return result.rows.length > 0 ? result.rows.map(map => new MapInfo(map)) : null
  } finally {
    done()
  }
}
