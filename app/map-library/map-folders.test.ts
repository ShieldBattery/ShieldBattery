import { describe, expect, test } from 'vitest'
import { LocalMapRoot } from '../../common/map-library'
import {
  childFolders,
  folderForFile,
  isMapFilename,
  isSkippedTopLevelFolder,
  MapRootFolder,
} from './map-folders'

const ROOTS: MapRootFolder[] = [
  { root: LocalMapRoot.Install, path: 'C:\\Program Files (x86)\\StarCraft\\Maps' },
  { root: LocalMapRoot.Documents, path: 'C:\\Users\\Me\\Documents\\StarCraft\\maps' },
]

describe('app/map-library/map-folders', () => {
  test('recognizes map files by extension, ignoring case', () => {
    expect(isMapFilename('Bound.scx')).toBe(true)
    expect(isMapFilename('(2)Boxer.SCM')).toBe(true)
    expect(isMapFilename('LastReplay.rep')).toBe(false)
    expect(isMapFilename('scm')).toBe(false)
  })

  test('skips the replay and save folders, ignoring case', () => {
    expect(isSkippedTopLevelFolder('Replays')).toBe(true)
    expect(isSkippedTopLevelFolder('save')).toBe(true)
    expect(isSkippedTopLevelFolder('Download')).toBe(false)
  })

  test('builds folders from the root key and the folders below the root', () => {
    expect(folderForFile('C:\\Program Files (x86)\\StarCraft\\Maps\\(2)Boxer.scm', ROOTS)).toBe(
      'install',
    )
    expect(
      folderForFile('C:\\Users\\Me\\Documents\\StarCraft\\maps\\Download\\UMS\\a.scx', ROOTS),
    ).toBe('documents/Download/UMS')
    expect(folderForFile('c:\\users\\me\\documents\\starcraft\\MAPS\\Ladder\\b.scm', ROOTS)).toBe(
      'documents/Ladder',
    )
    expect(folderForFile('D:\\elsewhere\\c.scm', ROOTS)).toBeUndefined()
    expect(folderForFile('C:\\Users\\Me\\Documents\\StarCraft\\maps2\\d.scm', ROOTS)).toBe(
      undefined,
    )
  })

  const COUNTS = [
    { folder: 'install', count: 300 },
    { folder: 'install/Ladder', count: 20 },
    { folder: 'documents', count: 5 },
    { folder: 'documents/Download', count: 7 },
    { folder: 'documents/Download/UMS', count: 3 },
    { folder: 'documents/download/Melee', count: 2 },
    { folder: 'documents/UMS_old', count: 4 },
  ]

  test('lists the roots with every file below them', () => {
    expect(childFolders(COUNTS)).toEqual([
      { path: 'documents', name: 'documents', fileCount: 21 },
      { path: 'install', name: 'install', fileCount: 320 },
    ])
  })

  test('lists child folders with recursive counts, merging differently cased spellings', () => {
    expect(childFolders(COUNTS, 'documents')).toEqual([
      { path: 'documents/Download', name: 'Download', fileCount: 12 },
      { path: 'documents/UMS_old', name: 'UMS_old', fileCount: 4 },
    ])
    expect(childFolders(COUNTS, 'DOCUMENTS/download')).toEqual([
      { path: 'DOCUMENTS/download/Melee', name: 'Melee', fileCount: 2 },
      { path: 'DOCUMENTS/download/UMS', name: 'UMS', fileCount: 3 },
    ])
  })

  test('does not treat a sibling sharing a prefix as a child', () => {
    expect(childFolders(COUNTS, 'documents/UMS')).toEqual([])
  })
})
