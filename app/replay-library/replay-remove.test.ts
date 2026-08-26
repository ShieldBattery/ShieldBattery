import { describe, expect, test } from 'vitest'
import { isWithinSaveFolders, isWithinWatchedFolders } from './replay-remove'

describe('app/replay-library/replay-remove/isWithinSaveFolders', () => {
  const FOLDERS = ['C:\\replays', 'D:\\archive']

  test('a file directly in the save subfolder of a watched folder is within it', () => {
    expect(isWithinSaveFolders('C:\\replays\\ShieldBattery\\a.rep', FOLDERS)).toBe(true)
  })

  test('a file nested under the save subfolder is within it', () => {
    expect(isWithinSaveFolders('D:\\archive\\ShieldBattery\\sub\\a.rep', FOLDERS)).toBe(true)
  })

  test('is case-insensitive', () => {
    expect(isWithinSaveFolders('c:\\REPLAYS\\shieldbattery\\A.REP', FOLDERS)).toBe(true)
  })

  test('a file directly in the watched folder (not its save subfolder) is not within it', () => {
    expect(isWithinSaveFolders('C:\\replays\\a.rep', FOLDERS)).toBe(false)
  })

  test('a file under an unwatched folder is not within it', () => {
    expect(isWithinSaveFolders('E:\\other\\ShieldBattery\\a.rep', FOLDERS)).toBe(false)
  })

  test('a sibling folder sharing the save subfolder name as a prefix is not within it', () => {
    expect(isWithinSaveFolders('C:\\replays\\ShieldBatteryBackup\\a.rep', FOLDERS)).toBe(false)
  })

  test('a `..` escape back out of the save subfolder is not within it', () => {
    expect(isWithinSaveFolders('C:\\replays\\ShieldBattery\\..\\evil.rep', FOLDERS)).toBe(false)
  })

  test('with no watched folders, nothing is within them', () => {
    expect(isWithinSaveFolders('C:\\replays\\ShieldBattery\\a.rep', [])).toBe(false)
  })
})

describe('app/replay-library/replay-remove/isWithinWatchedFolders', () => {
  const FOLDERS = ['C:\\replays', 'D:\\archive']

  test('a file directly in a watched folder is within it', () => {
    expect(isWithinWatchedFolders('C:\\replays\\a.rep', FOLDERS)).toBe(true)
  })

  test('a file in a nested subfolder of a watched folder is within it', () => {
    expect(isWithinWatchedFolders('D:\\archive\\2024\\sub\\a.rep', FOLDERS)).toBe(true)
  })

  test('a file under an unwatched folder is not within it', () => {
    expect(isWithinWatchedFolders('E:\\other\\a.rep', FOLDERS)).toBe(false)
  })

  test('is case-insensitive', () => {
    expect(isWithinWatchedFolders('c:\\REPLAYS\\A.REP', FOLDERS)).toBe(true)
  })

  test('a `..` escape back out of a watched folder is not within it', () => {
    expect(isWithinWatchedFolders('C:\\replays\\..\\evil.rep', FOLDERS)).toBe(false)
  })

  test('with no watched folders, nothing is within them', () => {
    expect(isWithinWatchedFolders('C:\\replays\\a.rep', [])).toBe(false)
  })
})
