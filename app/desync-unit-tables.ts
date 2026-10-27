import fsPromises from 'node:fs/promises'
import path from 'node:path'

/**
 * Prefix of the unit tables the game DLL writes to the logs directory when the relay evicts it
 * for a desync (`desync-units-<game id>.csv`). The DLL keeps only the newest few.
 */
const DESYNC_UNIT_TABLE_PREFIX = 'desync-units-'

/** How old a unit table can be and still be considered part of a recent problem. */
const MAX_UNIT_TABLE_AGE_MS = 7 * 24 * 60 * 60 * 1000

/**
 * Finds the newest desync unit table in `logsDir` written within the last week, returning its
 * path, or `undefined` if there is none.
 */
export async function findNewestDesyncUnitTable(
  logsDir: string,
  now = Date.now(),
): Promise<string | undefined> {
  const names = await fsPromises.readdir(logsDir)
  let newest: { filePath: string; mtimeMs: number } | undefined
  for (const name of names) {
    if (!name.startsWith(DESYNC_UNIT_TABLE_PREFIX) || !name.endsWith('.csv')) {
      continue
    }
    const filePath = path.join(logsDir, name)
    try {
      const stats = await fsPromises.stat(filePath)
      if (
        stats.isFile() &&
        now - stats.mtimeMs <= MAX_UNIT_TABLE_AGE_MS &&
        (!newest || stats.mtimeMs > newest.mtimeMs)
      ) {
        newest = { filePath, mtimeMs: stats.mtimeMs }
      }
    } catch {
      // Deleted between listing and stat, most likely by the DLL pruning old tables.
    }
  }
  return newest?.filePath
}
