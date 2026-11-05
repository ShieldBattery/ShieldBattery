import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { MapTileId } from '../../common/map-tiles'
import { MapExtension } from '../../common/maps'
import { LocalMapTiles } from './map-tiles'
import { MapImageRenderer, RenderedMapImage } from './worker/map-renderer-client'

const HASH = 'a'.repeat(64)
const BUILD_KEY = '864772b9ff94f6d372aa4ee90ee2f8ab'
const IMAGE: RenderedMapImage = { width: 2, height: 1, bgra: new Uint8Array(8) }
const TILE: MapTileId = { hash: HASH, format: 'scm', density: 32, x: 3, y: 4 }

describe('app/map-library/map-tiles/LocalMapTiles', () => {
  let tempDir: string
  let installPath: string
  let cacheDir: string
  let renderTile: ReturnType<typeof vi.fn<MapImageRenderer['renderTile']>>
  let findPath: ReturnType<
    typeof vi.fn<(hash: string, format: MapExtension) => Promise<string | undefined>>
  >

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'sb-map-tiles-'))
    installPath = path.join(tempDir, 'StarCraft')
    cacheDir = path.join(tempDir, 'cache')
    await mkdir(installPath)
    await writeFile(
      path.join(installPath, '.build.info'),
      `Branch!STRING:0|Active!DEC:1|Build Key!HEX:16\nus|1|${BUILD_KEY}\n`,
    )
    renderTile = vi.fn<MapImageRenderer['renderTile']>().mockResolvedValue(IMAGE)
    findPath = vi.fn().mockResolvedValue('C:\\maps\\map.scm')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function createTiles(getInstallPath = async () => installPath as string | undefined) {
    return new LocalMapTiles({
      cacheDir,
      getInstallPath,
      findPath,
      renderer: { render: vi.fn(), renderTile },
      encodeJpeg: image => Buffer.from(`jpeg ${image.width}x${image.height}`),
      logger: { warning: () => {}, verbose: () => {} },
    })
  }

  test('renders a tile once and serves it from the cache after', async () => {
    const tiles = createTiles()
    const [first, concurrent] = await Promise.all([tiles.getTile(TILE), tiles.getTile(TILE)])
    expect(first?.toString()).toBe('jpeg 2x1')
    expect(concurrent).toEqual(first)
    expect(renderTile).toHaveBeenCalledTimes(1)
    expect(renderTile).toHaveBeenCalledWith(installPath, 'C:\\maps\\map.scm', HASH, {
      density: 32,
      x: 3,
      y: 4,
    })

    const cached = await createTiles().getTile(TILE)
    expect(cached?.toString()).toBe('jpeg 2x1')
    expect(renderTile).toHaveBeenCalledTimes(1)

    await createTiles().getTile({ ...TILE, x: 4 })
    expect(renderTile).toHaveBeenCalledTimes(2)
  })

  test('returns nothing without an install, a sane density or a map file', async () => {
    expect(await createTiles(async () => undefined).getTile(TILE)).toBeUndefined()
    expect(await createTiles().getTile({ ...TILE, density: 64 })).toBeUndefined()
    expect(await createTiles().getTile({ ...TILE, density: 1.5 })).toBeUndefined()
    findPath.mockResolvedValue(undefined)
    expect(await createTiles().getTile(TILE)).toBeUndefined()
    expect(renderTile).not.toHaveBeenCalled()
  })

  test('renders a tile once its map file shows up', async () => {
    findPath.mockResolvedValueOnce(undefined)
    const tiles = createTiles()
    expect(await tiles.getTile(TILE)).toBeUndefined()
    expect((await tiles.getTile(TILE))?.toString()).toBe('jpeg 2x1')
  })

  test("doesn't retry a failed render in the same session", async () => {
    renderTile.mockRejectedValue(new Error('off the map'))
    const tiles = createTiles()
    expect(await tiles.getTile(TILE)).toBeUndefined()
    expect(await tiles.getTile(TILE)).toBeUndefined()
    expect(renderTile).toHaveBeenCalledTimes(1)
  })

  test('keeps the tiles of the most recently rendered maps', async () => {
    const tiles = createTiles()
    for (let i = 0; i < 26; i++) {
      await tiles.getTile({ ...TILE, hash: i.toString(16).padStart(64, '0') })
      // Spaces the maps' times apart, since they're compared to pick which to delete
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const keyDir = path.join(cacheDir, `${BUILD_KEY}-r1`)
    const maps = await readdir(keyDir)
    expect(maps).toHaveLength(24)
    expect(maps).not.toContain('0'.repeat(64))
    expect(maps).toContain((25).toString(16).padStart(64, '0'))
  })
})
