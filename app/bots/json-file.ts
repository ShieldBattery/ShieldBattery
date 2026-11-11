/**
 * Reading and writing the app's small JSON state files. Every write goes to a temporary file that
 * is then renamed over the target, so a crash mid-write leaves the previous contents intact rather
 * than a truncated file the next launch can't read.
 */

import { randomBytes } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'

export async function writeJsonFileAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.tmp-${randomBytes(6).toString('hex')}`
  try {
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), 'utf8')
    await fs.rename(temporary, filePath)
  } catch (err) {
    await fs.rm(temporary, { force: true })
    throw err
  }
}

/**
 * Reads a JSON file, returning undefined when it doesn't exist. Malformed contents throw, so the
 * caller can decide between ignoring a corrupt file and refusing to overwrite it.
 */
export async function readJsonFile(filePath: string): Promise<unknown> {
  let contents: string
  try {
    contents = await fs.readFile(filePath, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
  return JSON.parse(contents)
}
