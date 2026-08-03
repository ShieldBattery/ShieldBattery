import Chk from 'bw-chk'
import jpeg from 'jpeg-js'
import { isMainThread, parentPort } from 'node:worker_threads'
import { filterColorCodes, MapExtension, MapForce, MapForcePlayerRace } from '../../../common/maps'
import { MapParseData } from './parse-data'
import { parseAndHashMap } from './parse-map'

if (isMainThread) {
  throw new Error('map-parse-worker should not be run in the main thread')
}

export interface MapParseWorkerRequest {
  path: string
  extension: MapExtension
  bwDataPath: string
}

export interface MapParseWorkerSuccess {
  mapData: MapParseData
  image256?: Buffer
  image512?: Buffer
  image1024?: Buffer
  image2048?: Buffer
}

export interface MapParseWorkerFailure {
  error: string
}

export type MapParseWorkerResponse = MapParseWorkerSuccess | MapParseWorkerFailure

const RACE_ID_TO_NAME: Record<number, MapForcePlayerRace> = {
  0: 'z',
  1: 't',
  2: 'p',
  5: 'any',
}

/**
 * Builds the force/player layout used to set up UMS lobbies from a parsed map's CHK data.
 *
 * While `RACE_ID_TO_NAME`'s keys are the "intended" mappings, there are other values that a map
 * can use. At least race 6 makes SC:R melee lobbies default to random race without requiring the
 * user to select it, the same way race 5 would. But we have our own lobby system, which doesn't
 * require users to explicitly choose races before starting a game.
 *
 * This `forces` data is only used by us to set up UMS lobbies. The player race in UMS mainly
 * selects which music & UI console are used. The exception is race 5 ('any'), where the player
 * selects a race, gets no preplaced units, and spawns with that race's starting units. So falling
 * back to terran here is fine.
 */
function createLobbyInitData(chk: Chk): { forces: MapForce[] } {
  return {
    // Convert race ids to strings, set each force's teamId, and filter out empty ones.
    forces: chk.forces
      .map(({ name, players }, index): MapForce => ({
        name,
        teamId: index + 1,
        players: players.map(({ id, race, computer, typeId }) => ({
          id,
          computer,
          typeId,
          race: RACE_ID_TO_NAME[race] ?? 't',
        })),
      }))
      .filter(f => f.players.length !== 0),
  }
}

/** Creates a JPEG preview image with the given width, computing height to preserve the map's aspect ratio. */
async function generateImage(
  map: Chk,
  bwDataPath: string,
  width: number,
): Promise<Buffer | undefined> {
  if (!bwDataPath) {
    return undefined
  }

  const height = Math.round((width * map.size[1]) / map.size[0])

  const imageRgb = await map.image(Chk.fsFileAccess(bwDataPath), width, height, { melee: true })
  const rgbaBuffer = Buffer.alloc(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    rgbaBuffer[i * 4] = imageRgb[i * 3]
    rgbaBuffer[i * 4 + 1] = imageRgb[i * 3 + 1]
    rgbaBuffer[i * 4 + 2] = imageRgb[i * 3 + 2]
  }
  const { data } = jpeg.encode({ data: rgbaBuffer, width, height }, 90)
  return data
}

parentPort!.once('message', (request: MapParseWorkerRequest) => {
  const { path, extension, bwDataPath } = request

  Promise.resolve()
    .then(async () => {
      const { hash, map } = await parseAndHashMap(path, extension)
      const [image256, image512, image1024, image2048] = await Promise.all([
        generateImage(map, bwDataPath, 256),
        generateImage(map, bwDataPath, 512),
        generateImage(map, bwDataPath, 1024),
        generateImage(map, bwDataPath, 2048),
      ])

      const mapData: MapParseData = {
        hash,
        title: filterColorCodes(map.title),
        description: filterColorCodes(map.description),
        width: map.size[0],
        height: map.size[1],
        tileset: map.tileset,
        meleePlayers: map.maxPlayers(false),
        umsPlayers: map.maxPlayers(true),
        isEud: map.isEudMap(),
        lobbyInitData: createLobbyInitData(map),
      }

      const response: MapParseWorkerSuccess = {
        mapData,
        image256,
        image512,
        image1024,
        image2048,
      }
      parentPort!.postMessage(response)
    })
    .catch(err => {
      const response: MapParseWorkerFailure = { error: err.stack ?? String(err) }
      parentPort!.postMessage(response)
    })
})
