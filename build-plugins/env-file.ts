import { readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'

/**
 * Parses the dotenv-format file at `path` into a fresh object, leaving `process.env` untouched. A
 * missing file reads as empty, since every setting these files hold has a fallback.
 */
export function readEnvFile(path: string): Record<string, string> {
  let contents: string
  try {
    contents = readFileSync(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw err
  }
  return parseEnv(contents) as Record<string, string>
}
