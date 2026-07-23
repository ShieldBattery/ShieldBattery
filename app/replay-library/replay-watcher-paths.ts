import path from 'node:path'

/**
 * Path-containment and index-pruning decisions for the replay watcher, factored out as pure
 * functions (no filesystem access) so they can be unit-tested directly.
 *
 * All comparisons use `path.win32` unconditionally: replay paths are always Windows paths (the app
 * only runs on Windows), so this keeps behavior identical on a Linux CI runner, where the default
 * `path` would treat backslashes as ordinary characters.
 */

/** Lower-cases and canonicalizes a Windows path so containment can compare case-insensitively. */
function normalizeForContainment(p: string): string {
  return path.win32.normalize(p).toLowerCase()
}

/**
 * Whether `filePath` sits inside `root` (or equals it). The comparison lands on separator
 * boundaries so `C:\replays2` is not considered to be under `C:\replays`; it is case-insensitive
 * and normalizes separators (`/` vs `\`) and `.`/`..` segments.
 */
export function isPathUnderRoot(filePath: string, root: string): boolean {
  const normFile = normalizeForContainment(filePath)
  const normRoot = normalizeForContainment(root)
  if (normFile === normRoot) {
    return true
  }
  const rootWithSep = normRoot.endsWith(path.win32.sep) ? normRoot : normRoot + path.win32.sep
  return normFile.startsWith(rootWithSep)
}

/**
 * Decides whether an already-indexed replay path should be pruned from the index during a
 * reconcile.
 *
 * The hazard this guards against: a transient read failure — an offline or unplugged drive, a
 * permission blip, an unavailable network mount or junction — makes a directory temporarily
 * unreadable. Pruning its rows then would cascade away the user's bookmarks and playlist entries
 * for replays that still physically exist — so rows under any directory that couldn't be read this
 * reconcile are always kept.
 *
 * A row is treated as vanished (and pruned) only when:
 *  (a) its path is under NO currently-configured root — the root was removed from settings, so the
 *      user deliberately stopped indexing it; or
 *  (b) its path is under a configured root whose scan succeeded — including every directory on the
 *      way down to the file — yet the scan didn't find the file: it was genuinely deleted/moved.
 *
 * `scannedRoots` must be the subset of `configuredRoots` whose top-level read succeeded this
 * reconcile; `unreadableDirs` must hold every directory (configured root or subfolder discovered
 * mid-walk) whose read failed, so a failure anywhere below a scanned root still protects the rows
 * beneath it.
 */
export function isIndexedPathVanished(
  existingPath: string,
  configuredRoots: ReadonlyArray<string>,
  scannedRoots: ReadonlyArray<string>,
  scannedFiles: ReadonlySet<string>,
  unreadableDirs: ReadonlyArray<string>,
): boolean {
  const underConfigured = configuredRoots.some(root => isPathUnderRoot(existingPath, root))
  if (!underConfigured) {
    // (a) No longer covered by any configured root.
    return true
  }
  if (scannedFiles.has(existingPath)) {
    return false
  }
  if (unreadableDirs.some(dir => isPathUnderRoot(existingPath, dir))) {
    // The scan couldn't read some directory containing this row, so its absence from the scan
    // proves nothing — keep it.
    return false
  }
  // Under a configured root but not seen in the scan: prune only if a root that could contain it
  // actually scanned this reconcile. Otherwise its containing root was unreadable (e.g. an offline
  // drive) and the row is left untouched.
  return scannedRoots.some(root => isPathUnderRoot(existingPath, root))
}
