import { readFile } from 'node:fs/promises'
import path from 'node:path'

/**
 * Returns the build key of the active build in the contents of a StarCraft install's `.build.info`,
 * which changes whenever a game patch changes the install's files. That file is a `|`-separated
 * table whose header names each column as `Name!TYPE:size`, with one row per installed build.
 */
export function parseActiveBuildKey(buildInfo: string): string | undefined {
  const [header, ...rows] = buildInfo.split(/\r?\n/).filter(line => line && !line.startsWith('#'))
  if (!header) {
    return undefined
  }
  const columns = header.split('|').map(column => column.split('!')[0])
  const activeColumn = columns.indexOf('Active')
  const buildKeyColumn = columns.indexOf('Build Key')
  if (buildKeyColumn === -1) {
    return undefined
  }

  for (const row of rows) {
    const values = row.split('|')
    if (activeColumn === -1 || values[activeColumn] === '1') {
      const buildKey = values[buildKeyColumn]
      return /^[0-9a-f]+$/i.test(buildKey ?? '') ? buildKey.toLowerCase() : undefined
    }
  }
  return undefined
}

/** Reads the active build key of the StarCraft install at `installPath`, if it has one. */
export async function readInstallBuildKey(installPath: string): Promise<string | undefined> {
  try {
    return parseActiveBuildKey(await readFile(path.join(installPath, '.build.info'), 'utf8'))
  } catch {
    return undefined
  }
}
