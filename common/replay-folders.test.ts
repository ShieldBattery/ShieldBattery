import { describe, expect, test } from 'vitest'
import {
  countByFolder,
  folderSegments,
  isInsideFolder,
  listReplayFolders,
  normalizeFolderPath,
} from './replay-folders'

const ROOT = 'C:\\Users\\Me\\Documents\\StarCraft\\Maps\\Replays'

describe('common/replay-folders/normalizeFolderPath', () => {
  test('converts forward slashes and drops trailing separators', () => {
    expect(normalizeFolderPath('C:/replays/2024/')).toBe('C:\\replays\\2024')
    expect(normalizeFolderPath('C:\\replays\\\\')).toBe('C:\\replays')
  })
})

describe('common/replay-folders/isInsideFolder', () => {
  test('a folder is inside itself and its ancestors', () => {
    expect(isInsideFolder('C:\\replays\\2024', 'C:\\replays\\2024')).toBe(true)
    expect(isInsideFolder('C:\\replays\\2024\\ASL', 'C:\\replays')).toBe(true)
  })

  test('rejects a sibling that only shares a name prefix', () => {
    expect(isInsideFolder('C:\\replays\\2024-old', 'C:\\replays\\2024')).toBe(false)
    expect(isInsideFolder('C:\\replays\\2024-old\\x', 'C:\\replays\\2024')).toBe(false)
  })

  test('is case-insensitive and separator-agnostic', () => {
    expect(isInsideFolder('c:/REPLAYS/2024', 'C:\\replays\\')).toBe(true)
  })
})

describe('common/replay-folders/countByFolder', () => {
  test('tallies files by the folder they sit directly in', () => {
    expect(
      countByFolder([
        `${ROOT}\\a.rep`,
        `${ROOT}\\b.rep`,
        `${ROOT}\\2024\\c.rep`,
        `${ROOT}/2024/d.rep`,
      ]),
    ).toEqual([
      { folder: ROOT, count: 2 },
      { folder: `${ROOT}\\2024`, count: 2 },
    ])
  })
})

describe('common/replay-folders/listReplayFolders', () => {
  const counts = countByFolder([
    `${ROOT}\\top.rep`,
    `${ROOT}\\2024\\ASL\\a.rep`,
    `${ROOT}\\2024\\ASL\\b.rep`,
    `${ROOT}\\2024\\c.rep`,
    `${ROOT}\\2024-old\\d.rep`,
    `${ROOT}\\Season 10\\e.rep`,
    `${ROOT}\\Season 9\\f.rep`,
    `${ROOT}\\Season 2\\deep\\er\\g.rep`,
  ])

  test('the top level lists each watched folder holding replays, named by its last segment', () => {
    expect(listReplayFolders(counts, [ROOT, 'D:\\Empty'])).toEqual({
      folder: undefined,
      folders: [{ path: ROOT, name: 'Replays', replayCount: 8 }],
    })
  })

  test('watched folders with trailing separators still match their replays', () => {
    expect(listReplayFolders(counts, [`${ROOT}\\`]).folders).toEqual([
      { path: ROOT, name: 'Replays', replayCount: 8 },
    ])
    expect(listReplayFolders(counts, [`${ROOT}\\`], `${ROOT}\\2024`).folder).toBe(`${ROOT}\\2024`)
  })

  test('lists direct subfolders with recursive counts, sorted numerically by name', () => {
    expect(listReplayFolders(counts, [ROOT], ROOT)).toEqual({
      folder: ROOT,
      folders: [
        { path: `${ROOT}\\2024`, name: '2024', replayCount: 3 },
        { path: `${ROOT}\\2024-old`, name: '2024-old', replayCount: 1 },
        { path: `${ROOT}\\Season 2`, name: 'Season 2', replayCount: 1 },
        { path: `${ROOT}\\Season 9`, name: 'Season 9', replayCount: 1 },
        { path: `${ROOT}\\Season 10`, name: 'Season 10', replayCount: 1 },
      ],
    })
  })

  test('a folder does not pick up a sibling sharing its name as a prefix', () => {
    expect(listReplayFolders(counts, [ROOT], `${ROOT}\\2024`)).toEqual({
      folder: `${ROOT}\\2024`,
      folders: [{ path: `${ROOT}\\2024\\ASL`, name: 'ASL', replayCount: 2 }],
    })
  })

  test('a folder holding replays only deeper down lists its intermediate subfolder', () => {
    expect(listReplayFolders(counts, [ROOT], `${ROOT}\\Season 2`).folders).toEqual([
      { path: `${ROOT}\\Season 2\\deep`, name: 'deep', replayCount: 1 },
    ])
  })

  test('matches case-insensitively and echoes the requested spelling exactly', () => {
    const requested = `${ROOT.toLowerCase()}\\2024\\`
    expect(listReplayFolders(counts, [ROOT], requested)).toEqual({
      folder: requested,
      folders: [{ path: `${ROOT}\\2024\\ASL`, name: 'ASL', replayCount: 2 }],
    })
  })

  test('merges spellings of one folder that differ only in case', () => {
    const mixed = countByFolder([
      `${ROOT}\\Pros\\a.rep`,
      `${ROOT}\\pros\\b.rep`,
      `${ROOT}\\PROS\\sub\\c.rep`,
    ])
    expect(listReplayFolders(mixed, [ROOT], ROOT).folders).toEqual([
      { path: `${ROOT}\\Pros`, name: 'Pros', replayCount: 3 },
    ])
  })

  test('a folder without replays falls back to its nearest ancestor that has some', () => {
    expect(listReplayFolders(counts, [ROOT], `${ROOT}\\2024\\Renamed\\Deeper`)).toEqual({
      folder: `${ROOT}\\2024`,
      folders: [{ path: `${ROOT}\\2024\\ASL`, name: 'ASL', replayCount: 2 }],
    })
  })

  test('falls back to the watched folder itself, then to the top level', () => {
    const onlyTop = countByFolder([`${ROOT}\\top.rep`])
    expect(listReplayFolders(onlyTop, [ROOT], `${ROOT}\\Gone`).folder).toBe(ROOT)
    expect(listReplayFolders([], [ROOT], `${ROOT}\\Gone`)).toEqual({
      folder: undefined,
      folders: [],
    })
  })

  test('a folder outside every watched folder falls back to the top level', () => {
    const outside = countByFolder([`${ROOT}\\a.rep`, 'E:\\Elsewhere\\b.rep'])
    expect(listReplayFolders(outside, [ROOT], 'E:\\Elsewhere')).toEqual({
      folder: undefined,
      folders: [{ path: ROOT, name: 'Replays', replayCount: 1 }],
    })
  })

  test('lists multiple watched folders, keeping each to its own replays', () => {
    const multi = countByFolder(['C:\\A\\one.rep', 'C:\\A\\sub\\two.rep', 'D:\\B\\three.rep'])
    expect(listReplayFolders(multi, ['C:\\A', 'D:\\B'])).toEqual({
      folder: undefined,
      folders: [
        { path: 'C:\\A', name: 'A', replayCount: 2 },
        { path: 'D:\\B', name: 'B', replayCount: 1 },
      ],
    })
    expect(listReplayFolders(multi, ['C:\\A', 'D:\\B'], 'D:\\B')).toEqual({
      folder: 'D:\\B',
      folders: [],
    })
  })

  test('watched folders sharing a name are named by their full paths', () => {
    const dupes = countByFolder([
      'C:\\x\\Replays\\a.rep',
      'D:\\y\\replays\\b.rep',
      'E:\\Other\\c.rep',
    ])
    expect(
      listReplayFolders(dupes, ['C:\\x\\Replays', 'D:\\y\\replays', 'E:\\Other']).folders.map(
        f => f.name,
      ),
    ).toEqual(['C:\\x\\Replays', 'D:\\y\\replays', 'Other'])
  })
})

describe('common/replay-folders/folderSegments', () => {
  test('runs from the watched folder down to the folder, in its spelling', () => {
    expect(folderSegments(`${ROOT.toLowerCase()}\\2024\\ASL`, [`${ROOT}\\`])).toEqual([
      { path: ROOT, name: 'Replays' },
      { path: `${ROOT}\\2024`, name: '2024' },
      { path: `${ROOT}\\2024\\ASL`, name: 'ASL' },
    ])
  })

  test('the watched folder alone is a single segment', () => {
    expect(folderSegments(ROOT, [ROOT])).toEqual([{ path: ROOT, name: 'Replays' }])
  })

  test('a folder outside every watched folder has no segments', () => {
    expect(folderSegments('C:\\Users\\Me\\Documents\\StarCraft\\Maps\\Replays-old', [ROOT])).toBe(
      undefined,
    )
  })

  test('picks the matching one of several watched folders, named by full path when shared', () => {
    expect(folderSegments('D:\\y\\replays\\sub', ['C:\\x\\Replays', 'D:\\y\\replays'])).toEqual([
      { path: 'D:\\y\\replays', name: 'D:\\y\\replays' },
      { path: 'D:\\y\\replays\\sub', name: 'sub' },
    ])
  })
})
