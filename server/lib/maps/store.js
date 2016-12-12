import Chk from 'bw-chk'
import fs from 'fs'
import jpeg from 'jpeg-js'
import config from '../../config.js'
import * as db from '../models/maps'
import { writeFile, getUrl } from '../file-upload'

// Takes both a parsed chk which it pulls metadata from,
// and the temppath of compressed mpq, which will be needed
// when the map is actually stored somewhere.
export async function storeMap(hash, extension, origFilename, map, timestamp, mapMpqPath) {
  // Maybe this function should revert everything it had done on error?
  // Shouldn't matter that much as the maps can be reuploaded as long as the database query
  // doesn't succeed (And that's the last thing this function does), but if there's a hash
  // collision, and the colliding maps are uploaded simultaneously, the actual file might differ
  // from the metadata stored in db.
  if (config.bwData) {
    // TODO(neiv): This really should run somewhere where it does not block everything...

    // Create 1024x1024 images, or, if the map is not a square, have the larger of the
    // dimensions be 1024 pixels.
    let width
    let height
    if (map.size[0] > map.size[1]) {
      width = 1024
      height = map.size[1] * Math.floor(1024 / map.size[0])
    } else {
      height = 1024
      width = map.size[0] * Math.floor(1024 / map.size[1])
    }

    const mapImageRgb =
        await map.image(Chk.fsFileAccess(config.bwData), width, height, { melee: true })
    const rgbaBuffer = new Buffer(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      rgbaBuffer[i * 4] = mapImageRgb[i * 3]
      rgbaBuffer[i * 4 + 1] = mapImageRgb[i * 3 + 1]
      rgbaBuffer[i * 4 + 2] = mapImageRgb[i * 3 + 2]
    }
    const { data } = jpeg.encode({
      data: rgbaBuffer,
      width,
      height,
    }, 90)

    await writeFile(imagePath(hash), data)
  }

  await writeFile(mapPath(hash, extension), fs.createReadStream(mapMpqPath))
  await db.addMap(hash, extension, origFilename, map, timestamp)
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
