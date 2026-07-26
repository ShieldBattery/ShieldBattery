import childProcess from 'child_process'
import fs from 'fs'
import { buffer } from 'node:stream/consumers'
import { Duplex, Readable, Writable } from 'stream'
import Queue from '../../../common/async/promise-queue'
import { isTestRun } from '../../../common/is-test-run'
import { MapExtension, MapVisibility } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { writeFile } from '../files'
import { addMap } from './map-models'
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
  const { messages, image256, image512, image1024, image2048 } = await runChildProcess(
    require.resolve('./map-parse-worker'),
    [path, extension, generateImages ? BW_DATA_PATH : ''],
  )

  if (messages.length !== 1) {
    throw new Error(
      'Expected exactly one message from map parse worked, but got ' + messages.length,
    )
  }

  if ('error' in messages[0]) {
    throw new Error(`Encountered error parsing map: ${messages[0].error}`)
  }

  return {
    mapData: messages[0],
    image256: BW_DATA_PATH ? image256 : undefined,
    image512: BW_DATA_PATH ? image512 : undefined,
    image1024: BW_DATA_PATH ? image1024 : undefined,
    image2048: BW_DATA_PATH ? image2048 : undefined,
  }
}

interface ChildProcessResult {
  messages: Array<MapParseData | { error: string }>
  image256: Buffer
  image512: Buffer
  image1024: Buffer
  image2048: Buffer
}

function runChildProcess(path: string, args?: ReadonlyArray<string>): Promise<ChildProcessResult> {
  let childTimeout: ReturnType<typeof setTimeout> | undefined
  const cleanup = () => {
    if (childTimeout) {
      clearTimeout(childTimeout)
    }
  }
  const result = new Promise<ChildProcessResult>((resolve, reject) => {
    const child = childProcess.fork(path, args, {
      stdio: [0, 1, 2, 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
    })
    const typedStdio = child.stdio as unknown as [
      stdin: Writable,
      stdout: Readable,
      stderr: Readable,
      img256: Readable,
      img512: Readable,
      img1024: Readable,
      img2048: Readable,
      ipc: Duplex,
    ]

    let error = false
    let inited = false
    // TODO(tec27): type this better
    const messages: any[] = []
    const resetTimeout = () => {
      if (childTimeout) {
        clearTimeout(childTimeout)
      }
      childTimeout = setTimeout(() => {
        child.kill()
        reject(new Error('Child process timeout'))
        error = true
      }, 60000)
    }
    resetTimeout()
    child.once('error', e => {
      // Should we kill the process here?? Some errors seem to happen when killing doesn't
      // make sense and others would leave
      child.kill()
      reject(e)
      error = true
    })

    // Start consuming the image pipes immediately: if the child writes image data before a
    // consumer is attached, that data would be lost. Collecting each pipe into a Buffer from the
    // start avoids that without requiring any synchronization messages between the processes.
    const imagesPromise = Promise.all([
      buffer(typedStdio[3]!),
      buffer(typedStdio[4]!),
      buffer(typedStdio[5]!),
      buffer(typedStdio[6]!),
    ])
    // Pipe errors get surfaced (or superseded by an earlier failure) through the exit handler
    // below; this just keeps a rejection while the child is still running from going unhandled
    imagesPromise.catch(() => {})

    child.on('exit', () => {
      imagesPromise
        .then(([image256, image512, image1024, image2048]) => {
          resolve({ messages, image256, image512, image1024, image2048 })
        })
        .catch(reject)
    })
    child.on('message', message => {
      if (inited) {
        resetTimeout()
        messages.push(message)
      }
    })
    // Even still, syncing with the child is dumb. Both sides will have any sent messages eaten
    // if they didn't get a chance to set .on('message') event handlers up yet.
    // The sync steps here are following:
    // 1) Parent spawns child and both set up their event handlers.
    // 2) Parent starts to send 'init' to the child to signal readiness, child may lose messages
    //    if it is still initializing.
    // 3) Child eventually receives 'init', sending a singe 'init' back to parent, to tell parent
    //    it can stop sending 'init'.
    // 4) Now parent process should not lose any future data that gets sent to it :l
    //    (Child doesn't get sent anything other than fork arguments and 'init' spam atm)
    child.once('message', msg => {
      console.assert(msg === 'init')
      inited = true
    })

    const sendInit = () => {
      if (inited || error) {
        return
      }

      child.send('init')
      setTimeout(sendInit, 10)
    }

    sendInit()
  })

  result.finally(cleanup).catch(() => {
    /* We return this promise so the error will be handled by whatever called this */
  })

  return result
}
