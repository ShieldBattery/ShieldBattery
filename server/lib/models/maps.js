import db from '../db'

function createLobbyInitData(chk) {
  const raceIdToName = {
    0: 'z',
    1: 't',
    2: 'p',
    5: 'any',
  }

  return {
    // Convert (acceptable) race ids to strings, set force's teamId and filter out empty ones.
    forces: chk.forces
      .map(({ name, players }, index) => ({
        name,
        teamId: index + 1,
        players: players.map(({ id, race, computer }) => {
          const raceName = raceIdToName[race]
          if (!raceName) {
            throw new Error(`Player ${id} has an invalid race ${race}`)
          }
          return {
            id,
            computer,
            race: raceName,
          }
        }),
      }))
      .filter(f => f.players.length !== 0),
  }
}

export async function addMap(hashStr, extension, filename, chk, timestamp) {
  const { client, done } = await db()
  try {
    const query = 'INSERT INTO maps ' +
        '(hash, extension, filename, title, description, width, height, tileset, ' +
        'players_melee, players_ums, upload_time, modified_time, lobby_init_data) ' +
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)'
    const hash = Buffer.from(hashStr, 'hex')
    const lobbyInitData = createLobbyInitData(chk)
    // Filename is varchar(32)
    // The filename is meant to just be potentially useful information that would be otherwise
    // lost on uploads (maybe there's a reason to search by it?), bw doesn't accept filenames
    // longer than 32 chars anyways, so just cut it silently.
    const limitedFilename = filename.slice(0, 32)
    const params = [hash, extension, limitedFilename, chk.title, chk.description,
      chk.size[0], chk.size[1], chk.tileset, chk.maxPlayers(false), chk.maxPlayers(true),
      new Date(), timestamp, lobbyInitData]
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

export async function mapInfo(hashStr) {
  let hash
  try {
    hash = Buffer.from(hashStr, 'hex')
  } catch (e) {
    return null
  }
  const { client, done } = await db()
  try {
    const query = 'SELECT extension, title, description, width, height, players_melee, ' +
        'players_ums, tileset ' +
        'FROM maps WHERE hash = $1'
    const result = await client.queryPromise(query, [ hash ])
    if (result.rows.length === 0) {
      return null
    } else {
      const res = result.rows[0]
      return {
        format: res.extension,
        tileset: [
          'badlands',
          'platform',
          'installation',
          'ashworld',
          'jungle',
          'desert',
          'ice',
          'twilight',
        ][res.tileset],
        name: res.title,
        description: res.description,
        slots: res.players_melee,
        umsSlots: res.players_ums,
        width: res.width,
        height: res.height,
      }
    }
  } finally {
    done()
  }
}
