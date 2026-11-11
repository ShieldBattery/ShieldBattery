import { describe, expect, test } from 'vitest'
import {
  checkPackageRelativePath,
  isSymlinkAttributes,
  MAX_PACKAGE_ENTRIES,
  ZipEntryGuard,
} from './zip-safety'

/** A regular file's external attributes, with unix mode 0644 in the high half. */
const REGULAR_FILE = (0o100644 << 16) >>> 0
const SYMLINK = (0o120777 << 16) >>> 0

function entry(fileName: string, uncompressedSize = 1, externalFileAttributes = REGULAR_FILE) {
  return { fileName, uncompressedSize, externalFileAttributes }
}

describe('app/bots/zip-safety/checkPackageRelativePath', () => {
  test('accepts a nested path', () => {
    expect(checkPackageRelativePath('bwapi-data/read/notes.dat')).toBe('bwapi-data/read/notes.dat')
  })

  test('treats backslashes as separators', () => {
    expect(checkPackageRelativePath('bwapi-data\\read\\notes.dat')).toBe(
      'bwapi-data/read/notes.dat',
    )
  })

  test('strips a trailing separator', () => {
    expect(checkPackageRelativePath('bwapi-data/read/')).toBe('bwapi-data/read')
  })

  test.each([
    ['an empty name', ''],
    ['a parent traversal', '../outside.txt'],
    ['a nested parent traversal', 'data/../../outside.txt'],
    ['a current-directory segment', './data/file.txt'],
    ['an absolute path', '/etc/passwd'],
    ['an absolute path with a backslash', '\\windows\\system32\\evil.dll'],
    ['a drive letter', 'C:\\windows\\evil.dll'],
    ['an alternate data stream', 'readme.txt:hidden'],
    ['a control character', 'read\u0001me.txt'],
    ['an empty segment', 'data//file.txt'],
    ['a device name', 'data/NUL'],
    ['a device name with an extension', 'data/COM1.txt'],
    ['a lowercase device name', 'aux'],
  ])('rejects %s', (_description, name) => {
    expect(() => checkPackageRelativePath(name)).toThrow()
  })
})

describe('app/bots/zip-safety/isSymlinkAttributes', () => {
  test('recognizes a symlink', () => {
    expect(isSymlinkAttributes(SYMLINK)).toBe(true)
  })

  test('leaves regular files alone', () => {
    expect(isSymlinkAttributes(REGULAR_FILE)).toBe(false)
    expect(isSymlinkAttributes(0)).toBe(false)
  })
})

describe('app/bots/zip-safety/ZipEntryGuard', () => {
  test('reports directories separately', () => {
    const guard = new ZipEntryGuard(1024)
    expect(guard.check(entry('data/', 0))).toEqual({ path: 'data', isDirectory: true })
    expect(guard.check(entry('data/file.txt'))).toEqual({
      path: 'data/file.txt',
      isDirectory: false,
    })
  })

  test('rejects symlink entries', () => {
    const guard = new ZipEntryGuard(1024)
    expect(() => guard.check(entry('link', 0, SYMLINK))).toThrow(/symbolic link/)
  })

  test('rejects names that differ only by case', () => {
    const guard = new ZipEntryGuard(1024)
    guard.check(entry('Data/File.txt'))
    expect(() => guard.check(entry('data/file.txt'))).toThrow(/duplicate/)
  })

  test('rejects too many entries', () => {
    const guard = new ZipEntryGuard(1024 * 1024 * 1024)
    for (let i = 0; i < MAX_PACKAGE_ENTRIES; i++) {
      guard.check(entry(`file-${i}.txt`, 0))
    }
    expect(() => guard.check(entry('one-too-many.txt', 0))).toThrow(/more than/)
  })

  test('rejects expansion beyond the ratio limit', () => {
    const guard = new ZipEntryGuard(1000)
    expect(() => guard.check(entry('bomb.bin', 41 * 1000))).toThrow(/times its own size/)
  })

  test('rejects expansion beyond the absolute limit', () => {
    const guard = new ZipEntryGuard(1024 * 1024 * 1024)
    expect(() => guard.check(entry('bomb.bin', 3 * 1024 * 1024 * 1024))).toThrow(/2 GiB/)
  })

  test('rejects a negative entry size', () => {
    const guard = new ZipEntryGuard(1024)
    expect(() => guard.check(entry('file.txt', -1))).toThrow(/invalid size/)
  })
})
