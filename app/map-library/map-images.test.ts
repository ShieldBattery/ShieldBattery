import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LOCAL_MAP_IMAGE_SIZE, LocalMapImages } from './map-images'
import { MapImageRenderer, RenderedMapImage } from './worker/map-renderer-client'

const HASH = 'a'.repeat(64)
const BUILD_KEY = '864772b9ff94f6d372aa4ee90ee2f8ab'
const IMAGE: RenderedMapImage = { width: 2, height: 1, bgra: new Uint8Array(8) }

describe('app/map-library/map-images/LocalMapImages', () => {
  let tempDir: string
  let installPath: string
  let cacheDir: string
  let render: ReturnType<typeof vi.fn<MapImageRenderer['render']>>
  let findPathByHash: ReturnType<typeof vi.fn<(hash: string) => Promise<string | undefined>>>

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'sb-map-images-'))
    installPath = path.join(tempDir, 'StarCraft')
    cacheDir = path.join(tempDir, 'cache')
    await mkdir(installPath)
    await writeFile(
      path.join(installPath, '.build.info'),
      `Branch!STRING:0|Active!DEC:1|Build Key!HEX:16\nus|1|${BUILD_KEY}\n`,
    )
    render = vi.fn<MapImageRenderer['render']>().mockResolvedValue(IMAGE)
    findPathByHash = vi.fn().mockResolvedValue('C:\\maps\\map.scm')
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  function createImages(getInstallPath = async () => installPath as string | undefined) {
    return new LocalMapImages({
      cacheDir,
      getInstallPath,
      findPathByHash,
      renderer: { render },
      encodeJpeg: image => Buffer.from(`jpeg ${image.width}x${image.height}`),
      logger: { warning: () => {}, verbose: () => {} },
    })
  }

  test('renders a map once and serves it from the cache after', async () => {
    const images = createImages()
    const [first, concurrent] = await Promise.all([images.getImage(HASH), images.getImage(HASH)])
    expect(first?.toString()).toBe('jpeg 2x1')
    expect(concurrent).toEqual(first)
    expect(render).toHaveBeenCalledTimes(1)
    expect(render).toHaveBeenCalledWith(
      installPath,
      'C:\\maps\\map.scm',
      HASH,
      LOCAL_MAP_IMAGE_SIZE,
    )

    const cached = await createImages().getImage(HASH)
    expect(cached?.toString()).toBe('jpeg 2x1')
    expect(render).toHaveBeenCalledTimes(1)
  })

  test('returns nothing without an install, a valid hash or an indexed file', async () => {
    expect(await createImages(async () => undefined).getImage(HASH)).toBeUndefined()
    expect(await createImages().getImage('../../evil')).toBeUndefined()
    findPathByHash.mockResolvedValue(undefined)
    expect(await createImages().getImage(HASH)).toBeUndefined()
    expect(render).not.toHaveBeenCalled()
  })

  test("doesn't retry a failed render in the same session", async () => {
    render.mockRejectedValue(new Error('broken map'))
    const images = createImages()
    expect(await images.getImage(HASH)).toBeUndefined()
    expect(await images.getImage(HASH)).toBeUndefined()
    expect(render).toHaveBeenCalledTimes(1)
  })

  test('clears images cached for other builds', async () => {
    const staleDir = path.join(cacheDir, 'oldbuild-r1-512')
    await mkdir(staleDir, { recursive: true })
    await writeFile(path.join(staleDir, `${HASH}.jpg`), 'stale')

    const image = await createImages().getImage(HASH)
    expect(image?.toString()).toBe('jpeg 2x1')
    await vi.waitFor(async () => {
      expect(await readdir(cacheDir)).toEqual([`${BUILD_KEY}-r1-${LOCAL_MAP_IMAGE_SIZE}`])
    })
    const cachedPath = path.join(cacheDir, `${BUILD_KEY}-r1-${LOCAL_MAP_IMAGE_SIZE}`, `${HASH}.jpg`)
    expect((await readFile(cachedPath)).toString()).toBe('jpeg 2x1')
  })
})
