import BufferList from 'bl'
import childProcess from 'child_process'
import fs from 'fs'
import { Duplex, Readable, Writable } from 'stream'
import Queue from '../../../common/async/promise-queue'
import { isTestRun } from '../../../common/is-test-run'
import { MapExtension, MapVisibility } from '../../../common/maps'
import { writeFile } from '../file-upload'
import { addMap } from './map-models'
import { MapParseData } from './parse-data'
import { MAP_PARSER_VERSION } from './parser-version'

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
  uploadedBy: number,
  visibility: MapVisibility,
) {
  const { mapData, image256Stream, image512Stream, image1024Stream, image2048Stream } =
    await parseMap(path, extension)
  const { hash } = mapData

  const map = await addMap(
    { mapData, extension, uploadedBy, visibility, parserVersion: MAP_PARSER_VERSION },
    async () => {
      const image256Promise = image256Stream
        ? writeFile(imagePath(hash, 256), image256Stream, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image512Promise = image512Stream
        ? writeFile(imagePath(hash, 512), image512Stream, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image1024Promise = image1024Stream
        ? writeFile(imagePath(hash, 1024), image1024Stream, {
            acl: 'public-read',
            type: 'image/jpeg',
          })
        : Promise.resolve()
      const image2048Promise = image2048Stream
        ? writeFile(imagePath(hash, 2048), image2048Stream, {
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
  const { mapData, image256Stream, image512Stream, image1024Stream, image2048Stream } =
    await mapQueue.addToQueue(() => mapParseWorker(path, extension))
  const { hash } = mapData

  const image256Promise = image256Stream
    ? writeFile(imagePath(hash, 256), image256Stream, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image512Promise = image512Stream
    ? writeFile(imagePath(hash, 512), image512Stream, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image1024Promise = image1024Stream
    ? writeFile(imagePath(hash, 1024), image1024Stream, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()
  const image2048Promise = image2048Stream
    ? writeFile(imagePath(hash, 2048), image2048Stream, {
        acl: 'public-read',
        type: 'image/jpeg',
      })
    : Promise.resolve()

  await Promise.all([image256Promise, image512Promise, image1024Promise, image2048Promise])
}

export function mapPath(hash: string, extension: MapExtension) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `maps/${firstByte}/${secondByte}/${hash}.${extension}`
}

export function imagePath(hash: string, size: 256 | 512 | 1024 | 2048) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `map_images/${firstByte}/${secondByte}/${hash}-${size}.jpg`
}

export interface MapParseResult {
  mapData: MapParseData
  image256Stream?: BufferList
  image512Stream?: BufferList
  image1024Stream?: BufferList
  image2048Stream?: BufferList
}

async function mapParseWorker(
  path: string,
  extension: MapExtension,
  generateImages = true,
): Promise<MapParseResult> {
  const { messages, image256Stream, image512Stream, image1024Stream, image2048Stream } =
    await runChildProcess(require.resolve('./map-parse-worker'), [
      path,
      extension,
      generateImages ? BW_DATA_PATH : '',
    ])

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
    image256Stream: BW_DATA_PATH ? image256Stream : undefined,
    image512Stream: BW_DATA_PATH ? image512Stream : undefined,
    image1024Stream: BW_DATA_PATH ? image1024Stream : undefined,
    image2048Stream: BW_DATA_PATH ? image2048Stream : undefined,
  }
}

interface ChildProcessResult {
  messages: Array<MapParseData | { error: string }>
  image256Stream: BufferList
  image512Stream: BufferList
  image1024Stream: BufferList
  image2048Stream: BufferList
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

    // If the child process writes image data to the pipe before we are able to handle it, it
    // will get lost. Buffering the data with a PassThrough prevents that, without requiring
    // the pipe consumer to send any synchronization messages themselves.
    const image256Stream = typedStdio[3]!.pipe(new BufferList())
    const image512Stream = typedStdio[4]!.pipe(new BufferList())
    const image1024Stream = typedStdio[5]!.pipe(new BufferList())
    const image2048Stream = typedStdio[6]!.pipe(new BufferList())
    child.on('exit', () =>
      resolve({ messages, image256Stream, image512Stream, image1024Stream, image2048Stream }),
    )
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
