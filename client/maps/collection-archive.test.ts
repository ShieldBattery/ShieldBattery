import { afterEach, describe, expect, it, vi } from 'vitest'
import { CollectionDownloadFile } from '../../common/typeshare'
import { buildCollectionArchive, CollectionTooLargeError } from './collection-archive'

interface ZipEntry {
  name: string
  method: number
  flags: number
  size: number
  bytes: Uint8Array
}

/** Reads the entries of a zip by its central directory (which Zip64 isn't needed for in tests). */
async function readZip(blob: Blob): Promise<ZipEntry[]> {
  const data = new Uint8Array(await blob.arrayBuffer())
  const view = new DataView(data.buffer)
  let eocd = data.length - 22
  while (view.getUint32(eocd, true) !== 0x06054b50) {
    eocd--
  }
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true)).toBe(0x02014b50)
    const flags = view.getUint16(offset + 8, true)
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const size = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength))
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const start = localOffset + 30 + localNameLength + localExtraLength
    entries.push({
      name,
      method,
      flags,
      size,
      bytes: data.slice(start, start + compressedSize),
    })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function stubFetch(contents: Record<string, Uint8Array | number>) {
  const fetchMock = vi.fn(async (url: string) => {
    const content = contents[url]
    if (typeof content === 'number') {
      return new Response('nope', { status: content })
    }
    return new Response(content as Uint8Array<ArrayBuffer>)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const bytes = (...values: number[]) => new Uint8Array(values)

describe('client/maps/collection-archive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const files: CollectionDownloadFile[] = [
    { name: 'a.scx', url: 'https://files/a' },
    { name: '투혼 1.3.scx', url: 'https://files/b' },
    { name: 'c.scm', url: 'https://files/c' },
  ]
  const contents = {
    'https://files/a': bytes(1, 2, 3),
    'https://files/b': bytes(4, 5, 6, 7, 8),
    'https://files/c': bytes(9),
  }

  it('writes the files in order, stored, under their names', async () => {
    const fetchMock = stubFetch(contents)

    const blob = await buildCollectionArchive(files, {})
    const entries = await readZip(blob)

    expect(entries.map(e => e.name)).toEqual(['a.scx', '투혼 1.3.scx', 'c.scm'])
    expect(entries.map(e => e.method)).toEqual([0, 0, 0])
    expect(entries.map(e => e.flags & 0x800)).toEqual([0x800, 0x800, 0x800])
    expect(entries.map(e => e.size)).toEqual([3, 5, 1])
    expect(Array.from(entries[1].bytes)).toEqual([4, 5, 6, 7, 8])
    expect(Array.from(entries[0].bytes)).toEqual([1, 2, 3])
    expect(Array.from(entries[2].bytes)).toEqual([9])
    expect(fetchMock).toHaveBeenCalledWith(
      'https://files/a',
      expect.objectContaining({ credentials: 'omit' }),
    )
  })

  it('reports progress after each file', async () => {
    stubFetch(contents)
    const onProgress = vi.fn()

    await buildCollectionArchive(files, { onProgress })

    expect(onProgress.mock.calls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ])
  })

  it('rejects when a response is not ok', async () => {
    stubFetch({ ...contents, 'https://files/b': 403 })

    await expect(buildCollectionArchive(files, {})).rejects.toThrow(/403/)
  })

  it('rejects when the files are over the size limit', async () => {
    stubFetch(contents)

    await expect(buildCollectionArchive(files, { maxBytes: 8 })).rejects.toBeInstanceOf(
      CollectionTooLargeError,
    )
  })

  it('accepts files exactly at the size limit', async () => {
    stubFetch(contents)

    await expect(buildCollectionArchive(files, { maxBytes: 9 })).resolves.toBeInstanceOf(Blob)
  })
})
