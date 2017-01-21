import childProcess from 'child_process'
import fs from 'fs'
import { PassThrough } from 'stream'
import config from '../../config.js'
import * as db from '../models/maps'
import { writeFile, getUrl } from '../file-upload'

// Takes both a parsed chk which it pulls metadata from,
// and the temppath of compressed mpq, which will be needed
// when the map is actually stored somewhere.
export async function storeMap(hash, extension, origFilename, timestamp, mapMpqPath) {
  // Maybe this function should revert everything it had done on error?
  // Shouldn't matter that much as the maps can be reuploaded as long as the database query
  // doesn't succeed (And that's the last thing this function does), but if there's a hash
  // collision, and the colliding maps are uploaded simultaneously, the actual file might differ
  // from the metadata stored in db.
  const { mapData, imageStream } = await mapParseWorker(mapMpqPath, extension, hash)
  if (imageStream) {
    await writeFile(imagePath(hash), imageStream)
  }

  await writeFile(mapPath(hash, extension), fs.createReadStream(mapMpqPath))
  await db.addMap(hash, extension, origFilename, mapData, timestamp)
}

export async function mapInfo(hash) {
  const info = await db.mapInfo(hash)
  if (!info) {
    return null
  } else {
    return {
      hash,
      mapUrl: await getUrl(mapPath(hash, info.format)),
      imageUrl: await getUrl(imagePath(hash)),
      ...info,
    }
  }
}

function mapPath(hash, extension) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `maps/${firstByte}/${secondByte}/${hash}.${extension}`
}

function imagePath(hash) {
  const firstByte = hash.substr(0, 2)
  const secondByte = hash.substr(2, 2)
  return `map_images/${firstByte}/${secondByte}/${hash}.jpg`
}

async function mapParseWorker(path, extension, hash) {
  const bwDataPath = config.bwData ? config.bwData : ''
  const {
    messages,
    binaryData,
  } = await runChildProcess('lib/maps/map-parse-worker', [path, extension, hash, bwDataPath])
  console.assert(messages.length === 1)
  return {
    mapData: messages[0],
    imageStream: config.bwData ? binaryData : null,
  }
}

function runChildProcess(path, args) {
  let childTimeout
  const cleanup = () => {
    if (childTimeout) {
      clearTimeout(childTimeout)
    }
  }
  return new Promise(async (resolve, reject) => {
    const opts = { stdio: [0, 1, 2, 'pipe', 'ipc'] }
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
    const binaryData = child.stdio[3].pipe(new PassThrough())
    child.on('exit', () => resolve({ messages, binaryData }))
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
  .then(ok => {
    cleanup()
    return Promise.resolve(ok)
  }, e => {
    cleanup()
    return Promise.reject(e)
  })
}
