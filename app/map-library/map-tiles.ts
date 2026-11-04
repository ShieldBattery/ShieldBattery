import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import {
  MAP_TILE_MAX_RENDER_SIZE,
  MAP_TILE_NATIVE_DENSITY,
  MAP_TILE_SIZE,
  mapTileDensities,
  MapTileId,
} from '../../common/map-tiles'
import { MapExtension } from '../../common/maps'
import { readInstallBuildKey } from './build-info'
import { LocalMapImagesLogger } from './map-images'
import { MapImageRenderer, RenderedMapImage } from './worker/map-renderer-client'

/**
 * Part of every cached tile's key. Bump it when what's rendered changes (the options, or a broodmap
 * update that changes its output), so tiles cached before are rendered again.
 */
const MAP_TILE_RENDER_VERSION = 1
/** The quality of the tiles' JPEGs, matching the server's JPEG map images. */
export const MAP_TILE_JPEG_QUALITY = 90
/**
 * How many maps' tiles stay cached. A map's tiles take about 5-10 MB per density, and the least
 * recently rendered maps are deleted past this.
 */
const MAX_CACHED_MAPS = 24

export interface LocalMapTilesOptions {
  /** The folder rendered tiles are cached in. Owned by this service: it deletes what's stale. */
  cacheDir: string
  /** The StarCraft install directory to read the game's art from, if one is set. */
  getInstallPath: () => Promise<string | undefined>
  /** The path of a readable map file with this hash and format, if there is one on this PC. */
  findPath: (hash: string, format: MapExtension) => Promise<string | undefined>
  renderer: MapImageRenderer
  /** Encodes a rendered image as a JPEG at `MAP_TILE_JPEG_QUALITY`. */
  encodeJpeg: (image: RenderedMapImage) => Buffer
  logger: LocalMapImagesLogger
}

/**
 * Tiles of full-detail map images, rendered from the StarCraft install's assets. Rendering one tile
 * renders its map whole at the tile's density, then cuts every tile of that density from it and
 * caches them on disk, keyed by file hash and the install's build.
 */
export class LocalMapTiles {
  /** Renders in progress, by the cache path of the density they render. */
  private readonly inFlight = new Map<string, Promise<Map<string, Buffer> | undefined>>()
  /** Cache paths of densities that failed to render, so they aren't retried for every tile. */
  private readonly failed = new Set<string>()
  /** The cache key whose stale siblings have been cleared. */
  private prunedKey: string | undefined

  constructor(private readonly options: LocalMapTilesOptions) {}

  /**
   * Returns the JPEG of one tile, or `undefined` if there's no such tile, no file to render it from,
   * no StarCraft install to render with, or the render failed.
   */
  async getTile(tile: MapTileId): Promise<Buffer | undefined> {
    if (
      !Number.isInteger(tile.density) ||
      tile.density < 1 ||
      tile.density > MAP_TILE_NATIVE_DENSITY
    ) {
      return undefined
    }
    const installPath = await this.options.getInstallPath()
    const buildKey = installPath ? await readInstallBuildKey(installPath) : undefined
    if (!installPath || !buildKey) {
      return undefined
    }

    const key = `${buildKey}-r${MAP_TILE_RENDER_VERSION}`
    this.pruneStale(key)
    const mapDir = path.join(this.options.cacheDir, key, tile.hash)
    const densityDir = path.join(mapDir, String(tile.density))
    const tileName = `${tile.x}-${tile.y}.jpg`

    try {
      return await readFile(path.join(densityDir, tileName))
    } catch {
      // Either not rendered yet, or not a tile of this map
    }
    if (this.failed.has(densityDir) || (await exists(densityDir))) {
      return undefined
    }

    let result = this.inFlight.get(densityDir)
    if (!result) {
      result = this.render(installPath, tile, mapDir, densityDir).finally(() => {
        this.inFlight.delete(densityDir)
      })
      this.inFlight.set(densityDir, result)
    }
    return (await result)?.get(tileName)
  }

  /** Renders every tile of `tile`'s map at its density, caches them and returns them by file name. */
  private async render(
    installPath: string,
    { hash, format, density }: MapTileId,
    mapDir: string,
    densityDir: string,
  ): Promise<Map<string, Buffer> | undefined> {
    const filePath = await this.options.findPath(hash, format)
    if (!filePath) {
      return undefined
    }

    const tiles = new Map<string, Buffer>()
    try {
      const image = await this.options.renderer.render(
        installPath,
        filePath,
        hash,
        MAP_TILE_MAX_RENDER_SIZE,
        density,
      )
      const mapWidth = image.width / density
      const mapHeight = image.height / density
      if (!mapTileDensities(mapWidth, mapHeight).includes(density)) {
        throw new Error(
          `${density} px per tile isn't a tile density of a ${mapWidth}x${mapHeight} map`,
        )
      }

      for (let y = 0; y * MAP_TILE_SIZE < image.height; y++) {
        for (let x = 0; x * MAP_TILE_SIZE < image.width; x++) {
          tiles.set(`${x}-${y}.jpg`, this.options.encodeJpeg(cropImage(image, x, y)))
          // Encoding runs on the main process, so it gives other work a turn between tiles.
          await new Promise(resolve => setImmediate(resolve))
        }
      }
    } catch (err) {
      this.failed.add(densityDir)
      this.options.logger.warning(
        `Couldn't render ${density} px/tile tiles of ${filePath}: ${getErrorStack(err)}`,
      )
      return undefined
    }

    try {
      // Written to a temporary folder first, so a crash mid-write never leaves a partial set of
      // tiles under the real one.
      const tempDir = `${densityDir}.${process.pid}.tmp`
      await rm(tempDir, { recursive: true, force: true })
      await mkdir(tempDir, { recursive: true })
      await Promise.all(
        Array.from(tiles, ([name, jpeg]) => writeFile(path.join(tempDir, name), jpeg)),
      )
      await rename(tempDir, densityDir)
      const now = new Date()
      await utimes(mapDir, now, now)
      await this.evictOldMaps(path.dirname(mapDir))
    } catch (err) {
      this.options.logger.warning(`Couldn't cache the tiles of ${filePath}: ${getErrorStack(err)}`)
    }
    return tiles
  }

  /** Deletes the tiles of the least recently rendered maps past `MAX_CACHED_MAPS`. */
  private async evictOldMaps(keyDir: string): Promise<void> {
    const entries = await readdir(keyDir)
    if (entries.length <= MAX_CACHED_MAPS) {
      return
    }
    const withTimes = await Promise.all(
      entries.map(async entry => {
        const entryPath = path.join(keyDir, entry)
        return { entryPath, mtime: (await stat(entryPath)).mtimeMs }
      }),
    )
    withTimes.sort((a, b) => b.mtime - a.mtime)
    await Promise.all(
      withTimes
        .slice(MAX_CACHED_MAPS)
        .map(({ entryPath }) => rm(entryPath, { recursive: true, force: true })),
    )
  }

  /** Deletes cached tiles under any key but `key`, once per key: they'll never be used again. */
  private pruneStale(key: string): void {
    if (this.prunedKey === key) {
      return
    }
    this.prunedKey = key
    const { cacheDir, logger } = this.options
    readdir(cacheDir)
      .then(entries =>
        Promise.all(
          entries
            .filter(entry => entry !== key)
            .map(entry => rm(path.join(cacheDir, entry), { recursive: true, force: true })),
        ),
      )
      .catch(err => {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          logger.verbose(`Couldn't clear stale map tiles: ${getErrorStack(err)}`)
        }
      })
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** Copies the tile at `x`, `y` (in tiles) out of `image`. Edge tiles are cut short. */
function cropImage(image: RenderedMapImage, x: number, y: number): RenderedMapImage {
  const left = x * MAP_TILE_SIZE
  const top = y * MAP_TILE_SIZE
  const width = Math.min(MAP_TILE_SIZE, image.width - left)
  const height = Math.min(MAP_TILE_SIZE, image.height - top)
  const bgra = new Uint8Array(width * height * 4)
  for (let row = 0; row < height; row++) {
    const start = ((top + row) * image.width + left) * 4
    bgra.set(image.bgra.subarray(start, start + width * 4), row * width * 4)
  }
  return { width, height, bgra }
}
