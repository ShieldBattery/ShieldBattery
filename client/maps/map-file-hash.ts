/**
 * Hashes a map file the way the server identifies map files: the hex-encoded SHA-256 of its
 * lowercase extension followed by its contents (what `mapsByHash` takes).
 */
export async function hashMapFile(file: File): Promise<string> {
  const dot = file.name.lastIndexOf('.')
  const extension = new TextEncoder().encode(
    dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase(),
  )
  const contents = new Uint8Array(await file.arrayBuffer())
  const bytes = new Uint8Array(extension.length + contents.length)
  bytes.set(extension)
  bytes.set(contents, extension.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('')
}
