import { CascStorage, MapRenderer } from '@shieldbattery/broodmap'
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { hashMapBytes, hasUmsContent, readMapSummary } from '../map-summary'
import { MapRendererWorkerData, RenderRequest, RenderResponse } from './messages'

// Renders images of map files with broodmap, reading the game's art straight from the StarCraft
// install. The images match the server's renders of uploaded maps: the same renderer and options,
// from the same (SD) assets. This runs in its own worker, replaced when idle and after very large
// maps, because broodmap's WebAssembly memory only ever grows and the shared asset cache alone
// holds ~100 MB.

if (isMainThread) {
  throw new Error('map-renderer should not be run in the main thread')
}

const { installPath } = workerData as MapRendererWorkerData

let storage: CascStorage | undefined

/** Opens the install's CASC storage on first use, so a worker that never renders never reads it. */
function getStorage(): CascStorage {
  storage ??= new CascStorage({
    open: (p: string) => openSync(path.join(installPath, p), 'r'),
    size: (fd: number) => fstatSync(fd).size,
    read: (fd: number, buffer: Uint8Array, position: number) =>
      readSync(fd, buffer, 0, buffer.length, position),
    close: (fd: number) => closeSync(fd),
    listDir: (p: string) => {
      try {
        return readdirSync(path.join(installPath, p))
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          return []
        }
        throw err
      }
    },
  })
  return storage
}

function render({ id, path: filePath, hash, size }: RenderRequest): RenderResponse {
  const bytes = readFileSync(filePath)
  if (hashMapBytes(filePath, bytes) !== hash) {
    throw new Error('the file changed since it was indexed')
  }

  // The server's options for map images: start locations are drawn by clients, and maps with UMS
  // content show their units as placed rather than filtered for melee.
  const options = JSON.stringify({
    style: 'original',
    size,
    startLocations: 'hidden',
    asPlaced: hasUmsContent(readMapSummary(bytes)),
  })
  const map = new MapRenderer(bytes)
  try {
    // Art the install lacks only leaves out the things drawn with it.
    map.loadAssets(getStorage(), options)
    const image = map.renderRgba(options)
    try {
      const pixels = image.data
      for (let i = 0; i < pixels.length; i += 4) {
        const red = pixels[i]
        pixels[i] = pixels[i + 2]
        pixels[i + 2] = red
      }
      return {
        id,
        width: image.width,
        height: image.height,
        bgra: pixels,
        fileSize: bytes.length,
      }
    } finally {
      image.free()
    }
  } finally {
    map.free()
  }
}

parentPort!.on('message', (request: RenderRequest) => {
  try {
    const response = render(request)
    parentPort!.postMessage(
      response,
      'bgra' in response ? [response.bgra.buffer as ArrayBuffer] : [],
    )
  } catch (err) {
    const response: RenderResponse = { id: request.id, error: getErrorStack(err) ?? String(err) }
    parentPort!.postMessage(response)
  }
})
