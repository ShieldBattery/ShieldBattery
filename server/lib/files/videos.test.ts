import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { sniffVideoType } from './videos'

describe('sniffVideoType', () => {
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sb-videos-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function writeTempFile(name: string, data: Buffer): Promise<string> {
    const filePath = path.join(dir, name)
    await writeFile(filePath, data)
    return filePath
  }

  test('detects mp4 from an ftyp box', async () => {
    // A minimal mp4-like buffer: 4-byte box size, `ftyp`, then some padding bytes.
    const buf = Buffer.concat([
      Buffer.from([0x00, 0x00, 0x00, 0x18]),
      Buffer.from('ftyp', 'ascii'),
      Buffer.from('isom', 'ascii'),
      Buffer.alloc(16),
    ])
    const filePath = await writeTempFile('video.mp4', buf)

    expect(await sniffVideoType(filePath)).toBe('mp4')
  })

  test('detects webm from EBML magic plus a webm DocType', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      // A stand-in for the EBML header elements leading up to the DocType string; real files
      // have DocType-id/size bytes here, but the sniffer only looks for the substring.
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
      Buffer.from('webm', 'ascii'),
      Buffer.alloc(8),
    ])
    const filePath = await writeTempFile('video.webm', buf)

    expect(await sniffVideoType(filePath)).toBe('webm')
  })

  test('rejects EBML magic without a webm DocType (e.g. a Matroska .mkv file)', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x1a, 0x45, 0xdf, 0xa3]),
      Buffer.from([0x01, 0x02, 0x03, 0x04]),
      Buffer.from('matroska', 'ascii'),
      Buffer.alloc(8),
    ])
    const filePath = await writeTempFile('video.mkv', buf)

    expect(await sniffVideoType(filePath)).toBeUndefined()
  })

  test('rejects a PNG-magic buffer', async () => {
    const buf = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ])
    const filePath = await writeTempFile('image.png', buf)

    expect(await sniffVideoType(filePath)).toBeUndefined()
  })

  test('rejects random garbage', async () => {
    const buf = Buffer.from('this is definitely not a video file, just plain text padding here')
    const filePath = await writeTempFile('garbage.bin', buf)

    expect(await sniffVideoType(filePath)).toBeUndefined()
  })

  test('rejects an empty file', async () => {
    const filePath = await writeTempFile('empty.bin', Buffer.alloc(0))

    expect(await sniffVideoType(filePath)).toBeUndefined()
  })

  test('rejects a file shorter than the magic lengths', async () => {
    const filePath = await writeTempFile('short.bin', Buffer.from([0x1a, 0x45, 0xdf]))

    expect(await sniffVideoType(filePath)).toBeUndefined()
  })
})
