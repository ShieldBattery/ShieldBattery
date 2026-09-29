import { stat } from 'node:fs/promises'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { asMockedFunction } from '../../common/testing/mocks'
import { isWithinSaveFolders, isWithinWatchedFolders, trashReplays } from './replay-remove'

vi.mock('node:fs/promises', async importOriginal => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  stat: vi.fn(),
}))

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

describe('app/replay-library/replay-remove/trashReplays', () => {
  const FOLDERS = ['C:\\replays']
  const A = 'C:\\replays\\a.rep'
  const B = 'C:\\replays\\b.rep'
  const MISSING = 'C:\\replays\\missing.rep'
  const OUTSIDE = 'E:\\other\\a.rep'

  beforeEach(() => {
    asMockedFunction(stat).mockReset()
    asMockedFunction(stat).mockImplementation(async filePath => {
      if (filePath === MISSING) {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' })
      }
      return {} as Awaited<ReturnType<typeof stat>>
    })
  })

  test('trashes every path and reports each outcome in order', async () => {
    const trashItem = vi.fn(async () => {})
    const onError = vi.fn()

    const results = await trashReplays([A, MISSING, B], FOLDERS, trashItem, onError)

    expect(results).toEqual([
      { path: A, outcome: 'trashed' },
      { path: MISSING, outcome: 'missing' },
      { path: B, outcome: 'trashed' },
    ])
    expect(trashItem.mock.calls).toEqual([[A], [B]])
    expect(onError).not.toHaveBeenCalled()
  })

  test('refuses a path outside the watched folders without touching it', async () => {
    const trashItem = vi.fn(async () => {})
    const onError = vi.fn()

    const results = await trashReplays([OUTSIDE, B], FOLDERS, trashItem, onError)

    expect(results.map(r => r.outcome)).toEqual(['failed', 'trashed'])
    expect(trashItem.mock.calls).toEqual([[B]])
    expect(onError).toHaveBeenCalledTimes(1)
  })

  test('keeps going after a path fails to trash', async () => {
    const trashItem = vi.fn(async (filePath: string) => {
      if (filePath === A) {
        throw new Error('locked')
      }
    })
    const onError = vi.fn()

    const results = await trashReplays([A, B], FOLDERS, trashItem, onError)

    expect(results.map(r => r.outcome)).toEqual(['failed', 'trashed'])
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
