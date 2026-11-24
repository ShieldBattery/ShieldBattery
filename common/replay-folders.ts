import { ReplayLibraryFolder, ReplayLibraryFolderListing } from './replays-library'

/**
 * Path logic for browsing the replay library by its folders on disk, derived purely from the
 * indexed replays' paths (nothing here touches the filesystem). Replay paths are absolute Windows
 * paths, so folders compare case-insensitively and on `\` boundaries: `C:\replays\2024` contains
 * `C:\replays\2024\ASL` but not `C:\replays\2024-old`. Plain string operations only, since the
 * renderer uses this too and has no `node:path`.
 */

const SEPARATOR = '\\'

/** How many indexed replays sit directly in one folder (not counting its subfolders). */
export interface ReplayFolderCount {
  folder: string
  count: number
}

/** A folder from a watched folder down to some folder inside it, as a breadcrumb shows it. */
export interface ReplayFolderSegment {
  path: string
  name: string
}

/** Converts `/` to `\` and drops trailing separators, so equal folders compare equal. */
export function normalizeFolderPath(folder: string): string {
  return folder.replaceAll('/', SEPARATOR).replace(/\\+$/, '')
}

function folderKey(folder: string): string {
  return normalizeFolderPath(folder).toLowerCase()
}

function isKeyInside(pathKey: string, folderKey: string): boolean {
  return pathKey === folderKey || pathKey.startsWith(folderKey + SEPARATOR)
}

/** Whether `path` is `folder` itself or anywhere beneath it. */
export function isInsideFolder(path: string, folder: string): boolean {
  return isKeyInside(folderKey(path), folderKey(folder))
}

function lastSegment(folder: string): string {
  return folder.slice(folder.lastIndexOf(SEPARATOR) + 1)
}

/** Tallies `paths` (replay file paths) by the folder each sits directly in. */
export function countByFolder(paths: Iterable<string>): ReplayFolderCount[] {
  const counts = new Map<string, number>()
  for (const path of paths) {
    const normalized = normalizeFolderPath(path)
    const separatorIndex = normalized.lastIndexOf(SEPARATOR)
    if (separatorIndex < 0) {
      continue
    }
    const folder = normalized.slice(0, separatorIndex)
    counts.set(folder, (counts.get(folder) ?? 0) + 1)
  }
  return Array.from(counts, ([folder, count]) => ({ folder, count }))
}

/** The watched folders, normalized, with differently-spelled duplicates of one folder dropped. */
function distinctRoots(roots: ReadonlyArray<string>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const root of roots) {
    const normalized = normalizeFolderPath(root)
    const key = normalized.toLowerCase()
    if (normalized && !seen.has(key)) {
      seen.add(key)
      result.push(normalized)
    }
  }
  return result
}

/**
 * The name a watched folder goes by: its last path segment, or its full path when another watched
 * folder shares that last segment (so the two stay distinguishable).
 */
function rootName(root: string, roots: ReadonlyArray<string>): string {
  const name = lastSegment(root)
  const nameKey = name.toLowerCase()
  const isShared = roots.some(
    other =>
      other.toLowerCase() !== root.toLowerCase() && lastSegment(other).toLowerCase() === nameKey,
  )
  return isShared ? root : name
}

/**
 * The outermost watched folder containing `folder`, so a folder inside nested watched folders is
 * always reached from the same one.
 */
function findRoot(folder: string, roots: ReadonlyArray<string>): string | undefined {
  const key = folderKey(folder)
  let found: string | undefined
  for (const root of roots) {
    if (
      isKeyInside(key, root.toLowerCase()) &&
      (found === undefined || root.length < found.length)
    ) {
      found = root
    }
  }
  return found
}

/**
 * The folders from the watched folder containing `folder` down to `folder` itself, or `undefined`
 * when no watched folder contains it. The watched folder is named per `rootName`; the folders below
 * it take their spelling from `folder`.
 */
export function folderSegments(
  folder: string,
  watchedFolders: ReadonlyArray<string>,
): ReplayFolderSegment[] | undefined {
  const roots = distinctRoots(watchedFolders)
  const root = findRoot(folder, roots)
  if (root === undefined) {
    return undefined
  }

  const segments: ReplayFolderSegment[] = [{ path: root, name: rootName(root, roots) }]
  const normalized = normalizeFolderPath(folder)
  if (normalized.length > root.length) {
    let path = root
    for (const name of normalized.slice(root.length + 1).split(SEPARATOR)) {
      path = path + SEPARATOR + name
      segments.push({ path, name })
    }
  }
  return segments
}

function countInside(counts: ReadonlyArray<ReplayFolderCount>, folder: string): number {
  const key = folderKey(folder)
  let total = 0
  for (const { folder: countFolder, count } of counts) {
    if (isKeyInside(folderKey(countFolder), key)) {
      total += count
    }
  }
  return total
}

/**
 * The folders directly inside `folder` that hold replays at any depth, sorted by name. Spellings of
 * one folder that differ only in case merge into a single entry spelled the way it was first seen.
 */
function childFolders(
  counts: ReadonlyArray<ReplayFolderCount>,
  folder: string,
): ReplayLibraryFolder[] {
  const key = folderKey(folder)
  const prefixLength = key.length + SEPARATOR.length
  const children = new Map<string, ReplayLibraryFolder>()
  for (const { folder: countFolder, count } of counts) {
    const normalized = normalizeFolderPath(countFolder)
    const countKey = normalized.toLowerCase()
    if (!countKey.startsWith(key + SEPARATOR)) {
      continue
    }
    const separatorIndex = normalized.indexOf(SEPARATOR, prefixLength)
    const childPath = separatorIndex < 0 ? normalized : normalized.slice(0, separatorIndex)
    const childKey = childPath.toLowerCase()
    const existing = children.get(childKey)
    if (existing) {
      existing.replayCount += count
    } else {
      children.set(childKey, { path: childPath, name: lastSegment(childPath), replayCount: count })
    }
  }

  return Array.from(children.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  )
}

/**
 * Lists the contents of `parent` from the per-folder replay `counts`: the watched folders holding
 * replays when `parent` is omitted, otherwise the folders inside `parent` that hold replays. A
 * `parent` that holds no replays (renamed, deleted, or outside every watched folder) resolves to its
 * nearest ancestor within a watched folder that still does, or to the top level when none does.
 */
export function listReplayFolders(
  counts: ReadonlyArray<ReplayFolderCount>,
  watchedFolders: ReadonlyArray<string>,
  parent?: string,
): ReplayLibraryFolderListing {
  const roots = distinctRoots(watchedFolders)

  const root = parent !== undefined ? findRoot(parent, roots) : undefined
  if (parent !== undefined && root !== undefined) {
    let candidate = normalizeFolderPath(parent)
    while (candidate.length >= root.length) {
      if (countInside(counts, candidate) > 0) {
        return {
          folder: candidate.length === normalizeFolderPath(parent).length ? parent : candidate,
          folders: childFolders(counts, candidate),
        }
      }
      candidate = candidate.slice(0, Math.max(candidate.lastIndexOf(SEPARATOR), 0))
    }
  }

  const folders: ReplayLibraryFolder[] = []
  for (const watched of roots) {
    const replayCount = countInside(counts, watched)
    if (replayCount > 0) {
      folders.push({ path: watched, name: rootName(watched, roots), replayCount })
    }
  }
  return { folder: undefined, folders }
}
