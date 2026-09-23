/**
 * Rules for what an installed bot package's archive may contain. Extraction writes attacker-shaped
 * names into a directory the app later executes from, so every entry name is checked against these
 * rules before anything is written, and the totals are bounded so a small archive can't fill the
 * disk.
 */

/** Entries past this count mean the archive isn't a bot package. */
export const MAX_PACKAGE_ENTRIES = 20_000
/** Upper bound on everything an archive expands to. */
export const MAX_PACKAGE_EXPANDED_BYTES = 2 * 1024 * 1024 * 1024
/** Expansion beyond this multiple of the archive's own size is treated as a decompression bomb. */
export const MAX_PACKAGE_EXPANSION_RATIO = 40

/**
 * Names Windows resolves to devices rather than files, in any directory and with any extension.
 * Creating one can hang or write to hardware instead of the disk.
 */
const WINDOWS_DEVICE_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`),
])

const S_IFMT = 0o170000
const S_IFLNK = 0o120000

export class UnsafeArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafeArchiveError'
  }
}

/**
 * Whether a zip entry's unix mode (the high half of its external file attributes) marks it as a
 * symbolic link. Extracting one would let the archive point at any path on the system.
 */
export function isSymlinkAttributes(externalFileAttributes: number): boolean {
  return ((externalFileAttributes >>> 16) & S_IFMT) === S_IFLNK
}

/**
 * Normalizes a package-relative path and rejects anything that could escape the package directory
 * or name something other than a plain file. Returns the path with `/` separators and no trailing
 * slash. Throws {@link UnsafeArchiveError} with a displayable reason otherwise.
 */
export function checkPackageRelativePath(rawPath: string): string {
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    throw new UnsafeArchiveError('Archive contains an entry with no name')
  }
  for (const char of rawPath) {
    const code = char.codePointAt(0)!
    if (code < 0x20 || code === 0x7f) {
      throw new UnsafeArchiveError(`Archive entry name contains a control character: ${rawPath}`)
    }
  }
  if (/^[A-Za-z]:/.test(rawPath)) {
    throw new UnsafeArchiveError(`Archive entry name has a drive letter: ${rawPath}`)
  }
  if (rawPath.includes(':')) {
    throw new UnsafeArchiveError(`Archive entry name contains a colon: ${rawPath}`)
  }
  // Backslashes are separators here, not name characters: Windows resolves them as separators no
  // matter what the archive intended.
  const normalized = rawPath.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalized.startsWith('/')) {
    throw new UnsafeArchiveError(`Archive entry name is an absolute path: ${rawPath}`)
  }
  if (normalized.length === 0) {
    throw new UnsafeArchiveError('Archive contains an entry with no name')
  }
  const segments = normalized.split('/')
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new UnsafeArchiveError(`Archive entry name has an empty path segment: ${rawPath}`)
    }
    if (segment === '.' || segment === '..') {
      throw new UnsafeArchiveError(`Archive entry name has a relative path segment: ${rawPath}`)
    }
    const deviceName = segment.split('.')[0].toUpperCase()
    if (WINDOWS_DEVICE_NAMES.has(deviceName)) {
      throw new UnsafeArchiveError(`Archive entry name is a device name: ${rawPath}`)
    }
  }
  return normalized
}

export function isSafePackageRelativePath(rawPath: string): boolean {
  try {
    checkPackageRelativePath(rawPath)
    return true
  } catch {
    return false
  }
}

export interface ArchiveEntryInfo {
  fileName: string
  uncompressedSize: number
  externalFileAttributes: number
}

export interface CheckedArchiveEntry {
  /** Package-relative path with `/` separators. */
  path: string
  isDirectory: boolean
}

/**
 * Checks each entry of one archive and tracks its running totals. A guard belongs to a single
 * extraction: the case-insensitive name set and byte totals are what make duplicate names and
 * decompression bombs visible.
 */
export class ZipEntryGuard {
  private readonly seenPaths = new Set<string>()
  private entryCount = 0
  private expandedBytes = 0

  constructor(private readonly archiveSizeBytes: number) {}

  check(entry: ArchiveEntryInfo): CheckedArchiveEntry {
    this.entryCount += 1
    if (this.entryCount > MAX_PACKAGE_ENTRIES) {
      throw new UnsafeArchiveError(`Archive has more than ${MAX_PACKAGE_ENTRIES} entries`)
    }
    if (isSymlinkAttributes(entry.externalFileAttributes)) {
      throw new UnsafeArchiveError(`Archive entry is a symbolic link: ${entry.fileName}`)
    }
    const isDirectory = /[\\/]$/.test(entry.fileName)
    const checkedPath = checkPackageRelativePath(entry.fileName)
    const caseKey = checkedPath.toLowerCase()
    if (this.seenPaths.has(caseKey)) {
      throw new UnsafeArchiveError(`Archive has duplicate entries named ${checkedPath}`)
    }
    this.seenPaths.add(caseKey)

    if (!isDirectory) {
      const size = entry.uncompressedSize
      if (!Number.isSafeInteger(size) || size < 0) {
        throw new UnsafeArchiveError(`Archive entry has an invalid size: ${checkedPath}`)
      }
      this.expandedBytes += size
      if (this.expandedBytes > MAX_PACKAGE_EXPANDED_BYTES) {
        throw new UnsafeArchiveError('Archive expands to more than 2 GiB')
      }
      if (this.expandedBytes > this.archiveSizeBytes * MAX_PACKAGE_EXPANSION_RATIO) {
        throw new UnsafeArchiveError(
          `Archive expands to more than ${MAX_PACKAGE_EXPANSION_RATIO} times its own size`,
        )
      }
    }

    return { path: checkedPath, isDirectory }
  }
}
