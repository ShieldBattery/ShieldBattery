import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { hashMapFile } from './map-file-hash'

describe('maps/map-file-hash', () => {
  test('hashes the lowercase extension followed by the contents', async () => {
    const contents = new Uint8Array([0, 1, 2, 250, 255])
    const expected = createHash('sha256').update('scx').update(contents).digest('hex')
    expect(await hashMapFile(new File([contents], '(4)Bound.SCX'))).toBe(expected)
  })

  test('tells apart files that differ only in extension', async () => {
    const contents = new Uint8Array([1, 2, 3])
    expect(await hashMapFile(new File([contents], 'a.scm'))).not.toBe(
      await hashMapFile(new File([contents], 'a.scx')),
    )
  })
})
