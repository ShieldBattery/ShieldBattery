import { createHash } from 'node:crypto'
import { promises as fsPromises } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MapExtension } from '../../common/maps'
import { MapStore } from './map-store'

const fetchMock = vi.hoisted(() => vi.fn<(url: string) => Promise<Response>>())

vi.mock('electron', () => ({ net: { fetch: fetchMock } }))
vi.mock('electron-is-dev', () => ({ default: false }))
vi.mock('../logger', () => ({
  default: { verbose: () => {}, warning: () => {}, error: () => {} },
}))

const FORMAT: MapExtension = 'scx'
const CONTENTS = 'pretend this is a map'
/** Map hashes cover the format as well as the file contents. */
const HASH = createHash('sha256').update(FORMAT).update(CONTENTS).digest('hex')

const ok = () => new Response(CONTENTS, { status: 200 })
const rejected = () => new Response('Request has expired', { status: 403 })

describe('MapStore', () => {
  let basePath: string
  let store: MapStore

  beforeEach(async () => {
    fetchMock.mockReset()
    basePath = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'sb-map-store-'))
    store = new MapStore(basePath)
  })

  afterEach(async () => {
    await fsPromises.rm(basePath, { recursive: true, force: true })
  })

  it('downloads a map that is not on disk', async () => {
    fetchMock.mockResolvedValueOnce(ok())

    await expect(store.downloadMap(HASH, FORMAT, 'https://maps/a')).resolves.toBe('downloaded')
    expect(fetchMock).toHaveBeenCalledWith('https://maps/a', expect.anything())
    await expect(fsPromises.readFile(store.getPath(HASH, FORMAT), 'utf8')).resolves.toBe(CONTENTS)
    await expect(store.checkMaps([{ hash: HASH, format: FORMAT }])).resolves.toEqual([HASH])
  })

  it('reports a rejected URL without writing anything', async () => {
    fetchMock.mockResolvedValueOnce(rejected())

    await expect(store.downloadMap(HASH, FORMAT, 'https://maps/expired')).resolves.toBe(
      'urlRejected',
    )
    await expect(fsPromises.stat(store.getPath(HASH, FORMAT))).rejects.toThrow()
    await expect(store.checkMaps([{ hash: HASH, format: FORMAT }])).resolves.toEqual([])
  })

  it('retries a rejected URL with a newer one from a request that joined the download', async () => {
    let answerFirst!: (res: Response) => void
    fetchMock
      .mockReturnValueOnce(new Promise(resolve => (answerFirst = resolve)))
      .mockResolvedValueOnce(ok())

    const first = store.downloadMap(HASH, FORMAT, 'https://maps/expired')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const joined = store.downloadMap(HASH, FORMAT, 'https://maps/fresh')
    answerFirst(rejected())

    await expect(first).resolves.toBe('downloaded')
    await expect(joined).resolves.toBe('downloaded')
    expect(fetchMock).toHaveBeenLastCalledWith('https://maps/fresh', expect.anything())
  })

  it('starts over with the next request after a rejection', async () => {
    fetchMock.mockResolvedValueOnce(rejected()).mockResolvedValueOnce(ok())

    await expect(store.downloadMap(HASH, FORMAT, 'https://maps/expired')).resolves.toBe(
      'urlRejected',
    )
    await expect(store.downloadMap(HASH, FORMAT, 'https://maps/fresh')).resolves.toBe('downloaded')
  })

  it('fails on other error statuses', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }))

    await expect(store.downloadMap(HASH, FORMAT, 'https://maps/a')).rejects.toThrow('500')
  })
})
