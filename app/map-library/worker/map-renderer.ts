import {
  CascStorage,
  MapRenderer,
  type MapSummary,
  type RenderedImage,
} from '@shieldbattery/broodmap'
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import path from 'node:path'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { mapTileDensities, mapTileSpan } from '../../../common/map-tiles'
import { hashMapBytes, hasUmsContent, MAP_LIMIT_OPTIONS, readMapSummary } from '../map-summary'
import { MapRendererWorkerData, RenderRequest, RenderResponse, RenderTile } from './messages'

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

/** Reads the file at `filePath`, failing if it no longer hashes to `hash`. */
function readMapFile(filePath: string, hash: string): Buffer {
  const bytes = readFileSync(filePath)
  if (hashMapBytes(filePath, bytes) !== hash) {
    throw new Error('the file changed since it was indexed')
  }
  return bytes
}

/**
 * The server's options for map images: start locations are drawn by clients, and maps with UMS
 * content show their units as placed rather than filtered for melee.
 */
function imageOptions(summary: MapSummary, size: number) {
  return {
    style: 'original',
    size,
    startLocations: 'hidden',
    asPlaced: hasUmsContent(summary),
  }
}

/** Takes `image`'s pixels in BGRA order (what `nativeImage` takes), then frees it. */
function takeBgra(image: RenderedImage): { width: number; height: number; bgra: Uint8Array } {
  try {
    const pixels = image.data
    for (let i = 0; i < pixels.length; i += 4) {
      const red = pixels[i]
      pixels[i] = pixels[i + 2]
      pixels[i + 2] = red
    }
    return { width: image.width, height: image.height, bgra: pixels }
  } finally {
    image.free()
  }
}

function renderWhole(id: number, filePath: string, hash: string, size: number): RenderResponse {
  const bytes = readMapFile(filePath, hash)
  const options = JSON.stringify(imageOptions(readMapSummary(bytes), size))
  const map = new MapRenderer(bytes, MAP_LIMIT_OPTIONS)
  try {
    // Art the install lacks only leaves out the things drawn with it.
    map.loadAssets(getStorage(), options)
    return { id, ...takeBgra(map.renderRgba(options)), fileSize: bytes.length }
  } finally {
    map.free()
  }
}

/**
 * The map whose tiles were rendered last, kept parsed with its art loaded, since a viewer asks for
 * several tiles of the same map in a row.
 */
let tileMap:
  | {
      hash: string
      map: MapRenderer
      summary: MapSummary
      fileSize: number
      /** The densities whole-map art has been loaded for. */
      loaded: Set<number>
    }
  | undefined

function renderTile(id: number, filePath: string, hash: string, tile: RenderTile): RenderResponse {
  if (tileMap?.hash !== hash) {
    tileMap?.map.free()
    tileMap = undefined
    const bytes = readMapFile(filePath, hash)
    const summary = readMapSummary(bytes)
    tileMap = {
      hash,
      map: new MapRenderer(bytes, MAP_LIMIT_OPTIONS),
      summary,
      fileSize: bytes.length,
      loaded: new Set(),
    }
  }

  const { map, summary, fileSize, loaded } = tileMap
  if (!mapTileDensities(summary.width, summary.height).includes(tile.density)) {
    throw new Error(
      `${tile.density} px per tile isn't a tile density of a ${summary.width}x${summary.height} map`,
    )
  }
  // Every tile shares the whole map's pixel grid, so the size is the whole map's at this density
  const base = imageOptions(summary, Math.max(summary.width, summary.height) * tile.density)
  if (!loaded.has(tile.density)) {
    // Without a region this loads the art every tile needs, so it happens once per density
    map.loadAssets(getStorage(), JSON.stringify(base))
    loaded.add(tile.density)
  }
  const span = mapTileSpan(tile.density)
  const region = { x: tile.x * span, y: tile.y * span, width: span, height: span }
  const image = takeBgra(map.renderRgba(JSON.stringify({ ...base, region })))
  if (!image.width || !image.height) {
    throw new Error(`tile ${tile.x}-${tile.y} is off the map`)
  }
  return { id, ...image, fileSize }
}

function render(request: RenderRequest): RenderResponse {
  return 'tile' in request
    ? renderTile(request.id, request.path, request.hash, request.tile)
    : renderWhole(request.id, request.path, request.hash, request.size)
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
