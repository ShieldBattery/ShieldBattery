import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { MAP_TILE_NATIVE_DENSITY, MapTileId } from '../../common/map-tiles'
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
 * How many maps' tiles stay cached. A tile takes about 100 KB, so a fully viewed 256x256 map takes
 * about 30 MB, and the maps whose tiles were least recently rendered are deleted past this.
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
 * Tiles of full-detail map images, rendered one at a time from the StarCraft install's assets as
 * they're requested, and cached on disk keyed by file hash and the install's build.
 */
export class LocalMapTiles {
  private readonly inFlight = new Map<string, Promise<Buffer | undefined>>()
  /** Cache paths of tiles that failed to render, so they aren't retried for every request. */
  private readonly failed = new Set<string>()
  /** The cache folders of the maps whose tiles were rendered since the cache was last trimmed. */
  private readonly renderedMaps = new Set<string>()
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
    const tilePath = path.join(mapDir, String(tile.density), `${tile.x}-${tile.y}.jpg`)
    if (this.failed.has(tilePath)) {
      return undefined
    }

    let result = this.inFlight.get(tilePath)
    if (!result) {
      result = this.readOrRender(installPath, tile, mapDir, tilePath).finally(() => {
        this.inFlight.delete(tilePath)
      })
      this.inFlight.set(tilePath, result)
    }
    return result
  }

  private async readOrRender(
    installPath: string,
    { hash, format, density, x, y }: MapTileId,
    mapDir: string,
    tilePath: string,
  ): Promise<Buffer | undefined> {
    try {
      return await readFile(tilePath)
    } catch {
      // Not rendered yet
    }

    const filePath = await this.options.findPath(hash, format)
    if (!filePath) {
      return undefined
    }

    let jpeg: Buffer
    try {
      const image = await this.options.renderer.renderTile(installPath, filePath, hash, {
        density,
        x,
        y,
      })
      jpeg = this.options.encodeJpeg(image)
    } catch (err) {
      this.failed.add(tilePath)
      this.options.logger.warning(
        `Couldn't render tile ${x}-${y} at ${density} px/tile of ${filePath}: ${getErrorStack(err)}`,
      )
      return undefined
    }

    try {
      await mkdir(path.dirname(tilePath), { recursive: true })
      // Written under a temporary name first, so a crash mid-write never leaves a broken tile under
      // the real one.
      const tempPath = `${tilePath}.${process.pid}.tmp`
      await writeFile(tempPath, jpeg)
      await rename(tempPath, tilePath)
      if (!this.renderedMaps.has(mapDir)) {
        this.renderedMaps.add(mapDir)
        const now = new Date()
        await utimes(mapDir, now, now)
        await this.evictOldMaps(path.dirname(mapDir))
      }
    } catch (err) {
      this.options.logger.warning(`Couldn't cache a tile of ${filePath}: ${getErrorStack(err)}`)
    }
    return jpeg
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
    const evicted = withTimes.slice(MAX_CACHED_MAPS)
    for (const { entryPath } of evicted) {
      this.renderedMaps.delete(entryPath)
    }
    await Promise.all(
      evicted.map(({ entryPath }) => rm(entryPath, { recursive: true, force: true })),
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
