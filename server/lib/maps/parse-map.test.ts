import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { parseAndHashMap } from './parse-map'

// The fixture contains an uncompressed CHK. Bypass MPQ extraction while exercising the real
// bw-chk parser and the map parsing code under test.
vi.mock('scm-extractor', () => ({
  default: () => new PassThrough(),
}))

const SECTION_HEADER_SIZE = 8
const SECTION_LENGTH_OFFSET = 4
const STRINGS_SECTION_SIZE = 2
const PROPERTIES_SECTION_SIZE = 4
const TILESET_SECTION_SIZE = 2
const DIMENSIONS_SECTION_SIZE = 4
const DIMENSION_HEIGHT_OFFSET = 2
const FORCES_SECTION_SIZE = 20
const OWNERS_SECTION_SIZE = 12
const SIDES_SECTION_SIZE = 12
const VALID_MAP_WIDTH = 64
const VALID_MAP_HEIGHT = 32
const SHA_256_HEX_LENGTH = 64

function createSection(id: string, contents: Buffer): Buffer {
  const header = Buffer.alloc(SECTION_HEADER_SIZE)
  header.write(id, 0, 'ascii')
  header.writeUInt32LE(contents.length, SECTION_LENGTH_OFFSET)
  return Buffer.concat([header, contents])
}

function createChk(width: number, height: number): Buffer {
  const dimensions = Buffer.alloc(DIMENSIONS_SECTION_SIZE)
  dimensions.writeUInt16LE(width, 0)
  dimensions.writeUInt16LE(height, DIMENSION_HEIGHT_OFFSET)

  return Buffer.concat([
    createSection('STR\x20', Buffer.alloc(STRINGS_SECTION_SIZE)),
    createSection('SPRP', Buffer.alloc(PROPERTIES_SECTION_SIZE)),
    createSection('ERA\x20', Buffer.alloc(TILESET_SECTION_SIZE)),
    createSection('DIM\x20', dimensions),
    createSection('FORC', Buffer.alloc(FORCES_SECTION_SIZE)),
    createSection('OWNR', Buffer.alloc(OWNERS_SECTION_SIZE)),
    createSection('SIDE', Buffer.alloc(SIDES_SECTION_SIZE)),
    createSection('MTXM', Buffer.alloc(0)),
    createSection('UNIT', Buffer.alloc(0)),
    createSection('THG2', Buffer.alloc(0)),
  ])
}

describe('server/maps/parse-map', () => {
  let tempDir: string | undefined

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true })
      tempDir = undefined
    }
  })

  test('parses a map with positive dimensions', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'sb-map-parse-'))
    const path = join(tempDir, 'map.scm')
    await writeFile(path, createChk(VALID_MAP_WIDTH, VALID_MAP_HEIGHT))

    const { map, hash } = await parseAndHashMap(path, 'scm')

    expect(map.size).toEqual([VALID_MAP_WIDTH, VALID_MAP_HEIGHT])
    expect(hash).toMatch(new RegExp(`^[a-f0-9]{${SHA_256_HEX_LENGTH}}$`))
  })

  test.each([
    ['width', 0, VALID_MAP_HEIGHT],
    ['height', VALID_MAP_WIDTH, 0],
  ])('rejects a map with zero %s', async (_dimension, width, height) => {
    tempDir = await mkdtemp(join(tmpdir(), 'sb-map-parse-'))
    const path = join(tempDir, 'map.scm')
    await writeFile(path, createChk(width, height))

    await expect(parseAndHashMap(path, 'scm')).rejects.toThrow(
      `Invalid map dimensions: ${width}x${height}`,
    )
  })
})
