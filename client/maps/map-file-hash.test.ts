import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { hashMapFile, mapFileIdToHash } from './map-file-hash'

describe('maps/map-file-hash', () => {
  test('hashes the lowercase extension followed by the contents', async () => {
    const contents = new Uint8Array([0, 1, 2, 250, 255])
    const expected = createHash('sha256').update('scx').update(contents).digest('hex')
    expect(await hashMapFile(new File([contents], '(4)Bound.SCX'))).toBe(expected)
  })

  test('reads the hash out of a MapFile id', async () => {
    const contents = new Uint8Array([9, 8, 7])
    const digest = createHash('sha256').update('scm').update(contents)
    const base64 = digest.copy().digest('base64')
    expect(mapFileIdToHash(base64)).toBe(digest.digest('hex'))
    expect(mapFileIdToHash(base64)).toBe(await hashMapFile(new File([contents], 'x.scm')))
  })

  test('tells apart files that differ only in extension', async () => {
    const contents = new Uint8Array([1, 2, 3])
    expect(await hashMapFile(new File([contents], 'a.scm'))).not.toBe(
      await hashMapFile(new File([contents], 'a.scx')),
    )
  })
})
