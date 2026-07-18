import path from 'node:path'

/** Strips any path separators from a caller-supplied filename, leaving just the base name. */
export function sanitizeBaseFilename(filename: string): string {
  return path.basename(filename)
}

/**
 * Decides which filename to save a replay under, given how to look up the content hash of a
 * file that may already exist at a candidate name (`undefined` if nothing is there).
 *
 * Tries `<baseName>.rep` first, then `<baseName> (2).rep`, `<baseName> (3).rep`, etc., stopping at
 * the first candidate that either doesn't exist yet or already holds byte-identical content
 * (matched via `expectedHash`) -- in the latter case, `alreadyExists` is `true` so the caller can
 * reuse the existing file instead of writing a duplicate.
 */
export async function pickSaveFilename(
  baseName: string,
  expectedHash: string,
  existingHashAt: (name: string) => Promise<string | undefined>,
): Promise<{ name: string; alreadyExists: boolean }> {
  for (let attempt = 0; ; attempt++) {
    const name = attempt === 0 ? `${baseName}.rep` : `${baseName} (${attempt + 1}).rep`
    const existingHash = await existingHashAt(name)
    if (existingHash === undefined) {
      return { name, alreadyExists: false }
    }
    if (existingHash === expectedHash) {
      return { name, alreadyExists: true }
    }
  }
}
