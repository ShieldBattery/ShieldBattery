import { describe, expect, test } from 'vitest'
import { parseFileVersion, ReadAt } from './pe-version'
import { makeFakePeFile } from './testing/fake-pe-file'

function bufferReader(buf: Buffer): ReadAt {
  return async (offset, length) => buf.subarray(offset, offset + length)
}

describe('app/game/pe-version', () => {
  test('reads the file version of a 64-bit image', async () => {
    const file = makeFakePeFile({ fileVersion: [1, 23, 10, 13515] })
    expect(await parseFileVersion(bufferReader(file))).toEqual([1, 23, 10, 13515])
  })

  test('reads the file version of a 32-bit image', async () => {
    const file = makeFakePeFile({ is64Bit: false, fileVersion: [1, 23, 9, 10145] })
    expect(await parseFileVersion(bufferReader(file))).toEqual([1, 23, 9, 10145])
  })

  test('reads version components that use the full 16 bits', async () => {
    const file = makeFakePeFile({ fileVersion: [0xffff, 0x8000, 0xffff, 0x8001] })
    expect(await parseFileVersion(bufferReader(file))).toEqual([0xffff, 0x8000, 0xffff, 0x8001])
  })

  test('returns undefined for an image without resources', async () => {
    const file = makeFakePeFile({})
    expect(await parseFileVersion(bufferReader(file))).toBeUndefined()
  })

  test('returns undefined for a file that is not a PE image', async () => {
    const file = Buffer.from('this is just some text, not an executable at all.'.repeat(4))
    expect(await parseFileVersion(bufferReader(file))).toBeUndefined()
  })

  test('returns undefined for a truncated image', async () => {
    const file = makeFakePeFile({ fileVersion: [1, 23, 10, 13515] })
    // Cuts into the DOS header, PE headers, resource tree, and the fixed version fields
    for (const length of [0, 0x20, 0x80, 0x210, file.length - 45]) {
      expect(await parseFileVersion(bufferReader(file.subarray(0, length)))).toBeUndefined()
    }
  })
})
