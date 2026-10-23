import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import { readInstallBuildKey } from './build-info'
import { MapImageRenderer, RenderedMapImage } from './worker/map-renderer-client'

/** The longest side of a local map's image, in pixels: enough for a catalog tile on a 2x display. */
export const LOCAL_MAP_IMAGE_SIZE = 512
/**
 * Part of every cached image's key. Bump it when what's rendered changes (the options, or a
 * broodmap update that changes its output), so images cached before are rendered again.
 */
const LOCAL_MAP_RENDER_VERSION = 1
/** The server's quality for its JPEG map images (`JPEG_QUALITY` in `server-rs/src/maps/render.rs`). */
export const LOCAL_MAP_JPEG_QUALITY = 90

const HASH_PATTERN = /^[0-9a-f]{64}$/

export interface LocalMapImagesLogger {
  warning: (message: string) => void
  verbose: (message: string) => void
}

export interface LocalMapImagesOptions {
  /** The folder rendered images are cached in. Owned by this service: it deletes what's stale. */
  cacheDir: string
  /** The StarCraft install directory to read the game's art from, if one is set. */
  getInstallPath: () => Promise<string | undefined>
  /** The path of an indexed, readable map file with this hash. */
  findPathByHash: (hash: string) => Promise<string | undefined>
  renderer: MapImageRenderer
  /** Encodes a rendered image as a JPEG at `LOCAL_MAP_JPEG_QUALITY`. */
  encodeJpeg: (image: RenderedMapImage) => Buffer
  logger: LocalMapImagesLogger
}

/**
 * Images of the map files on this PC, rendered from the StarCraft install's assets the way the
 * server renders uploaded maps, so a file the server doesn't have looks like one it does. Images are
 * rendered on request and cached on disk by file hash, keyed by the install's build too, since a
 * game patch can change the assets.
 */
export class LocalMapImages {
  private readonly inFlight = new Map<string, Promise<Buffer | undefined>>()
  /** Cache paths of images that failed to render, so they aren't retried for every request. */
  private readonly failed = new Set<string>()
  /** The cache key whose stale siblings have been cleared. */
  private prunedKey: string | undefined

  constructor(private readonly options: LocalMapImagesOptions) {}

  /**
   * Returns the JPEG image of the map file with this hash, or `undefined` if there's no readable
   * file with it, no StarCraft install to render with, or the render failed.
   */
  async getImage(hash: string): Promise<Buffer | undefined> {
    if (!HASH_PATTERN.test(hash)) {
      return undefined
    }
    const installPath = await this.options.getInstallPath()
    const buildKey = installPath ? await readInstallBuildKey(installPath) : undefined
    if (!installPath || !buildKey) {
      return undefined
    }

    const key = `${buildKey}-r${LOCAL_MAP_RENDER_VERSION}-${LOCAL_MAP_IMAGE_SIZE}`
    this.pruneStale(key)
    const imagePath = path.join(this.options.cacheDir, key, `${hash}.jpg`)
    if (this.failed.has(imagePath)) {
      return undefined
    }

    let result = this.inFlight.get(imagePath)
    if (!result) {
      result = this.readOrRender(installPath, hash, imagePath).finally(() => {
        this.inFlight.delete(imagePath)
      })
      this.inFlight.set(imagePath, result)
    }
    return result
  }

  private async readOrRender(
    installPath: string,
    hash: string,
    imagePath: string,
  ): Promise<Buffer | undefined> {
    try {
      return await readFile(imagePath)
    } catch {
      // Not rendered yet
    }

    const filePath = await this.options.findPathByHash(hash)
    if (!filePath) {
      return undefined
    }

    let jpeg: Buffer
    try {
      const image = await this.options.renderer.render(
        installPath,
        filePath,
        hash,
        LOCAL_MAP_IMAGE_SIZE,
      )
      jpeg = this.options.encodeJpeg(image)
    } catch (err) {
      this.failed.add(imagePath)
      this.options.logger.warning(`Couldn't render an image of ${filePath}: ${getErrorStack(err)}`)
      return undefined
    }

    try {
      await mkdir(path.dirname(imagePath), { recursive: true })
      // Written under a temporary name first, so a crash mid-write never leaves a broken image
      // under the real one.
      const tempPath = `${imagePath}.${process.pid}.tmp`
      await writeFile(tempPath, jpeg)
      await rename(tempPath, imagePath)
    } catch (err) {
      this.options.logger.warning(`Couldn't cache the image of ${filePath}: ${getErrorStack(err)}`)
    }
    return jpeg
  }

  /** Deletes cached images under any key but `key`, once per key: they'll never be used again. */
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
          logger.verbose(`Couldn't clear stale map images: ${getErrorStack(err)}`)
        }
      })
  }
}
