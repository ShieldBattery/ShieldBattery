import { MapExtension } from './maps'

/**
 * Full-detail map images, served by the app in square tiles rendered from the StarCraft install, so
 * a zoomed-in view only ever holds the part of a map that's on screen. Each density renders the map
 * at a fixed number of pixels per map tile, cut into `MAP_TILE_SIZE` pieces.
 */

/** The side of a map image tile, in pixels. */
export const MAP_TILE_SIZE = 512
/** Pixels per map tile at the SD art's native resolution, the most detail there is. */
export const MAP_TILE_NATIVE_DENSITY = 32
/**
 * The largest side, in pixels, the app renders a whole map at to cut it into tiles. The renderer
 * holds a few copies of the whole image while rendering, so this bounds the app's memory: 256x256
 * maps get half of the native density.
 */
export const MAP_TILE_MAX_RENDER_SIZE = 4096
/** The longest side of the largest image the server renders of every map. */
const SERVER_IMAGE_SIZE = 2048

/** The path the app serves map image tiles under. */
export const MAP_TILE_PATH_PREFIX = '/map-tile/'

/**
 * The densities (pixels per map tile, highest first) the app renders tiles of a map at: those with
 * more detail than the server's largest image, up to `MAP_TILE_MAX_RENDER_SIZE`.
 */
export function mapTileDensities(width: number, height: number): number[] {
  const longest = Math.max(width, height)
  const densities = []
  for (let density = MAP_TILE_NATIVE_DENSITY; longest * density > SERVER_IMAGE_SIZE; density /= 2) {
    if (longest * density <= MAP_TILE_MAX_RENDER_SIZE) {
      densities.push(density)
    }
  }
  return densities
}

/**
 * The pixels per map tile of the server's largest image of a map. The server renders a whole number
 * of pixels per tile, at most the native density.
 */
export function serverImageDensity(width: number, height: number): number {
  return Math.min(
    MAP_TILE_NATIVE_DENSITY,
    Math.max(1, Math.floor(SERVER_IMAGE_SIZE / Math.max(width, height))),
  )
}

/** How many map tiles one image tile covers along each side, at `density`. */
export function mapTileSpan(density: number): number {
  return MAP_TILE_SIZE / density
}

/** A tile of a map file's image, identified by the file's hash and format. */
export interface MapTileId {
  hash: string
  format: MapExtension
  density: number
  x: number
  y: number
}

/** The URL of one tile of a map's image. Only the app serves these. */
export function mapTileUrl({ hash, format, density, x, y }: MapTileId): string {
  return `shieldbattery://app${MAP_TILE_PATH_PREFIX}${hash}/${format}/${density}/${x}-${y}`
}

const TILE_PATH_PATTERN = /^([0-9a-f]{64})\/(scm|scx)\/(\d+)\/(\d+)-(\d+)$/

/** Parses the part of a tile URL's path after `MAP_TILE_PATH_PREFIX`, if it names a tile. */
export function parseMapTilePath(tilePath: string): MapTileId | undefined {
  const match = TILE_PATH_PATTERN.exec(tilePath)
  if (!match) {
    return undefined
  }
  return {
    hash: match[1],
    format: match[2] as MapExtension,
    density: Number(match[3]),
    x: Number(match[4]),
    y: Number(match[5]),
  }
}
