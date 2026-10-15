import { init, parseReplay } from '@shieldbattery/broodrep'
import Chk from 'bw-chk'
import jpeg from 'jpeg-js'
import { createHash } from 'node:crypto'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'

if (isMainThread) {
  throw new Error('replay-map-image-worker must run in a worker thread')
}

const { replayBytes, bwDataPath, mode } = workerData as {
  replayBytes: Uint8Array
  bwDataPath?: string
  mode: 'thumbnail' | 'scenario'
}

Promise.resolve()
  .then(async () => {
    init()
    const replay = parseReplay(replayBytes)
    const mapData = replay.getRawSection('mapData')
    if (!mapData) throw new Error('replay has no embedded map')
    if (mode === 'scenario') {
      parentPort!.postMessage({ scenarioHash: createHash('sha256').update(mapData).digest('hex') })
      return
    }
    const map = new Chk(Buffer.from(mapData))
    if (!bwDataPath) throw new Error('map sprite data is unavailable')
    const width = 512
    const height = Math.round((width * map.size[1]) / map.size[0])
    if (!Number.isFinite(height) || height < 1 || height > 2048) {
      throw new Error('replay map has invalid dimensions')
    }
    const rgb = await map.image(Chk.fsFileAccess(bwDataPath), width, height, { melee: true })
    const rgba = Buffer.alloc(width * height * 4)
    for (let i = 0; i < width * height; i++) {
      rgba[i * 4] = rgb[i * 3]
      rgba[i * 4 + 1] = rgb[i * 3 + 1]
      rgba[i * 4 + 2] = rgb[i * 3 + 2]
      rgba[i * 4 + 3] = 255
    }
    parentPort!.postMessage({ image: jpeg.encode({ data: rgba, width, height }, 90).data })
  })
  .catch(err => parentPort!.postMessage({ error: String(err) }))
