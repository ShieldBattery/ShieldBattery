import childProcess from 'child_process'
import fs from 'fs'
import bl from 'bl'
import { addMap } from '../models/maps'
import { writeFile } from '../file-upload'
import Queue from '../../../common/async/promise-queue'

const BW_DATA_PATH = process.env.SB_SPRITE_DATA || ''
const MAX_CONCURRENT = Number(process.env.SB_MAP_PARSER_MAX_CONCURRENT)
if (Number.isNaN(MAX_CONCURRENT)) {
  throw new Error('SB_MAP_PARSER_MAX_CONCURRENT must be a number')
}
const mapQueue = new Queue(MAX_CONCURRENT)

// Takes both a parsed chk which it pulls metadata from,
// and the temppath of compressed mpq, which will be needed
// when the map is actually stored somewhere.
export async function storeMap(path, extension, uploadedBy, visibility) {
  const { mapData, imageStream, thumbnailStream } = await mapQueue.addToQueue(() =>
    mapParseWorker(path, extension),
  )
  const { hash } = mapData

  const mapParams = { mapData, extension, uploadedBy, visibility }
  const map = await addMap(mapParams, async () => {
    if (imageStream) {
      await writeFile(imagePath(hash), imageStream, { type: 'image/jpeg' })
    }
    if (thumbnailStream) {
      await writeFile(thumbnailPath(hash), thumbnailStream, { type: 'image/jpeg' })
    }
    await writeFile(mapPath(hash, extension), fs.createReadStream(path))
  })

  return map
}

export function mapPath(hash, extension) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `maps/${firstByte}/${secondByte}/${hash}.${extension}`
}

export function imagePath(hash) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `map_images/${firstByte}/${secondByte}/${hash}.jpg`
}

export function thumbnailPath(hash) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `map_thumbnails/${firstByte}/${secondByte}/${hash}.jpg`
}

async function mapParseWorker(path, extension) {
  const { messages, imageStream, thumbnailStream } = await runChildProcess(
    require.resolve('./map-parse-worker'),
    [path, extension, BW_DATA_PATH],
  )
  console.assert(messages.length === 1)
  return {
    mapData: messages[0],
    imageStream: BW_DATA_PATH ? imageStream : null,
    thumbnailStream: BW_DATA_PATH ? thumbnailStream : null,
  }
}

function runChildProcess(path, args) {
  let childTimeout
  const cleanup = () => {
    if (childTimeout) {
      clearTimeout(childTimeout)
    }
  }
  const result = new Promise(async (resolve, reject) => {
    const opts = { stdio: [0, 1, 2, 'pipe', 'pipe', 'ipc'] }
    const child = childProcess.fork(path, args, opts)
    let error = false
    let inited = false
    const messages = []
    const resetTimeout = () => {
      if (childTimeout) {
        clearTimeout(childTimeout)
      }
      childTimeout = setTimeout(() => {
        child.kill()
        reject('Child process timeout')
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
    const imageStream = child.stdio[3].pipe(bl())
    const thumbnailStream = child.stdio[4].pipe(bl())
    child.on('exit', () => resolve({ messages, imageStream, thumbnailStream }))
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
    while (!inited && !error) {
      child.send('init')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  })

  result.then(cleanup, cleanup)

  return result
}
