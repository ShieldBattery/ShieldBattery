import fs from 'fs'
import { Worker } from 'node:worker_threads'
import Queue from '../../../common/async/promise-queue'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { isTestRun } from '../../../common/is-test-run'
import { MapExtension, MapServiceErrorCode, MapVisibility } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import { writeFile } from '../files'
import { addMap } from './map-models'
import type { MapParseWorkerRequest, MapParseWorkerResponse } from './map-parse-worker'
import { MapParseData } from './parse-data'
import { MAP_PARSER_VERSION } from './parser-version'
import { imagePath, mapPath } from './paths'

const BW_DATA_PATH = process.env.SB_SPRITE_DATA || ''
let MAX_CONCURRENT = Number(process.env.SB_MAP_PARSER_MAX_CONCURRENT)
if (Number.isNaN(MAX_CONCURRENT)) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SB_MAP_PARSER_MAX_CONCURRENT must be a number')
  } else {
    MAX_CONCURRENT = 1
  }
}
// TODO(tec27): Should probably inject this or something instead
const mapQueue = !isTestRun()
  ? new Queue<MapParseResult>(MAX_CONCURRENT)
  : (undefined as any as Queue<MapParseResult>)

/**
 * Parses a map file, returning the results.
 *
 * This should generally only be used when re-parsing a map that was previously uploaded, otherwise
 * `storeMap` is the right option.
 */
export async function parseMap(
  path: string,
  extension: MapExtension,
  generateImages = true,
): Promise<MapParseResult> {
  return mapQueue.addToQueue(() => mapParseWorker(path, extension))
}

export class MapServiceError extends CodedError<MapServiceErrorCode> {}

/**
 * Parses information in a map, generates images for it, and stores the resulting files in our
 * remote filestore. Parsed information is recorded in the database.
 */
export async function storeMap(
  path: string,
  extension: MapExtension,
  uploadedBy: SbUserId,
  visibility: MapVisibility,
) {
  const { mapData, image256, image512, image1024, image2048 } = await parseMap(path, extension)
  const { hash } = mapData

  // A map with no start locations and no active force slots can't seat any players in either
  // melee or UMS games, so it could never be played. Storing it would also make it invisible in
  // every map listing (the player-count filters have no zero-player bucket), which reads as the
  // upload silently vanishing.
  if (mapData.meleePlayers === 0 && mapData.umsPlayers === 0) {
    throw new MapServiceError(
      MapServiceErrorCode.NoPlayerSlots,
      'Map has no start locations or active player slots',
    )
  }

  const map = await addMap(
    { mapData, extension, uploadedBy, visibility, parserVersion: MAP_PARSER_VERSION },
    async () => {
      const image256Promise = image256
        ? writeFile(imagePath(hash, 256), image256, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image512Promise = image512
        ? writeFile(imagePath(hash, 512), image512, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image1024Promise = image1024
        ? writeFile(imagePath(hash, 1024), image1024, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image2048Promise = image2048
        ? writeFile(imagePath(hash, 2048), image2048, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const mapPromise = writeFile(mapPath(hash, extension), fs.createReadStream(path))

      await Promise.all([
        image256Promise,
        image512Promise,
        image1024Promise,
        image2048Promise,
        mapPromise,
      ])
    },
  )

  return map
}

export async function storeRegeneratedImages(path: string, extension: MapExtension) {
  const { mapData, image256, image512, image1024, image2048 } = await mapQueue.addToQueue(() =>
    mapParseWorker(path, extension),
  )
  const { hash } = mapData

  const image256Promise = image256
    ? writeFile(imagePath(hash, 256), image256, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image512Promise = image512
    ? writeFile(imagePath(hash, 512), image512, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image1024Promise = image1024
    ? writeFile(imagePath(hash, 1024), image1024, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image2048Promise = image2048
    ? writeFile(imagePath(hash, 2048), image2048, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()

  await Promise.all([image256Promise, image512Promise, image1024Promise, image2048Promise])
}

export interface MapParseResult {
  mapData: MapParseData
  image256?: Buffer
  image512?: Buffer
  image1024?: Buffer
  image2048?: Buffer
}

async function mapParseWorker(
  path: string,
  extension: MapExtension,
  generateImages = true,
): Promise<MapParseResult> {
  const bwDataPath = generateImages ? BW_DATA_PATH : ''

  return new Promise<MapParseResult>((resolve, reject) => {
    const worker = new Worker(require.resolve('../../workers/launch-worker'), {
      name: 'map-parse-worker',
      workerData: require.resolve('./map-parse-worker'),
    })

    let settled = false
    const settle = (fn: () => void) => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      fn()
    }

    const timeout = setTimeout(() => {
      settle(() => reject(new Error('Timed out parsing map')))
      worker.terminate().catch(swallowNonBuiltins)
    }, 60000)

    worker
      .on('message', (response: MapParseWorkerResponse) => {
        settle(() => {
          if ('error' in response) {
            reject(new Error(`Encountered error parsing map: ${response.error}`))
          } else {
            resolve(response)
          }
        })
      })
      .on('error', err => {
        settle(() => reject(err instanceof Error ? err : new Error(String(err))))
      })
      .on('exit', code => {
        settle(() =>
          reject(new Error(`Map parse worker exited (code ${code}) before returning a result`)),
        )
      })

    const request: MapParseWorkerRequest = { path, extension, bwDataPath }
    worker.postMessage(request)
  })
}
