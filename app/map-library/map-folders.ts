import path from 'node:path'
import { LocalMapFolder, LocalMapRoot } from '../../common/map-library'
import { isPathUnderRoot } from '../replay-library/replay-watcher-paths'

/**
 * Folder paths for indexed map files, factored out as pure functions so they can be unit-tested.
 * A file's folder is its root's key followed by the folders below that root, `/`-separated
 * (`documents/Download/UMS`). Like the replay watcher's paths these are always Windows paths, so
 * `path.win32` is used regardless of the platform the code runs on.
 */

/** A folder the app indexes map files in. */
export interface MapRootFolder {
  root: LocalMapRoot
  /** The folder's absolute path. */
  path: string
}

/**
 * Folders directly inside a root that hold things other than maps the user would pick: SC:R saves
 * its replays and saved games under `Documents\StarCraft\maps`. Compared case-insensitively.
 */
const SKIPPED_TOP_LEVEL_FOLDERS: ReadonlySet<string> = new Set(['replays', 'save'])

/** The extensions of map files, lowercase. */
const MAP_EXTENSIONS: ReadonlySet<string> = new Set(['.scm', '.scx'])

/** Whether a file with this name is a map file to index. */
export function isMapFilename(fileName: string): boolean {
  return MAP_EXTENSIONS.has(path.win32.extname(fileName).toLowerCase())
}

/** Whether a folder directly inside a root is left out of the index (with everything below it). */
export function isSkippedTopLevelFolder(name: string): boolean {
  return SKIPPED_TOP_LEVEL_FOLDERS.has(name.toLowerCase())
}

/**
 * The folder path of `filePath`, by the first of `roots` that contains it, or `undefined` if none
 * does.
 */
export function folderForFile(
  filePath: string,
  roots: ReadonlyArray<MapRootFolder>,
): string | undefined {
  const root = roots.find(r => isPathUnderRoot(filePath, r.path))
  if (!root) {
    return undefined
  }
  const relativeDir = path.win32.relative(root.path, path.win32.dirname(filePath))
  const segments = relativeDir.split(path.win32.sep).filter(s => s && s !== '.')
  return [root.root, ...segments].join('/')
}

/** The form of a folder path that folder matching compares, so it ignores case. */
export function folderKey(folder: string): string {
  return folder.toLowerCase()
}

/**
 * The folders directly beneath `parent` (or the roots, when `parent` is unset) that hold map files,
 * with how many files each holds at any depth. `folderCounts` is how many files sit directly in
 * each folder. Folders compare case-insensitively; a folder's name comes from the first file path
 * that spells it.
 */
export function childFolders(
  folderCounts: ReadonlyArray<{ folder: string; count: number }>,
  parent?: string,
): LocalMapFolder[] {
  const parentSegments = parent === undefined ? [] : parent.split('/')
  const parentKey = parent === undefined ? undefined : folderKey(parent)
  const children = new Map<string, LocalMapFolder>()

  for (const { folder, count } of folderCounts) {
    const key = folderKey(folder)
    if (parentKey !== undefined && !key.startsWith(parentKey + '/')) {
      continue
    }
    const segments = folder.split('/')
    const name = segments[parentSegments.length]
    if (name === undefined) {
      continue
    }
    const childPath = [...parentSegments, name].join('/')
    const childKey = folderKey(childPath)
    const existing = children.get(childKey)
    if (existing) {
      existing.fileCount += count
    } else {
      children.set(childKey, { path: childPath, name, fileCount: count })
    }
  }

  return Array.from(children.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  )
}
