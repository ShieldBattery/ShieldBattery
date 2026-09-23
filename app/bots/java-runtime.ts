/**
 * Finding the Java runtimes installed on this PC. Java bots need a runtime of a specific major
 * version *and* bitness (a 32-bit bot process can only load a 32-bit JVM), so a candidate is only
 * usable once it has reported both, which means actually running it.
 */

import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BotArchitecture } from '../../common/bots/bot-catalog'
import { JavaRuntimeInfo } from '../../common/bots/bot-library'

/** How long a detected set is reused before the next scan re-runs every candidate. */
export const JAVA_DETECTION_CACHE_MS = 10 * 60 * 1000

const PROBE_TIMEOUT_MS = 5000

/** Directories under `%ProgramFiles%` that vendors install JDKs/JREs into. */
const VENDOR_DIRECTORIES = [
  'Java',
  'Eclipse Adoptium',
  'Microsoft',
  'Zulu',
  'AdoptOpenJDK',
  'BellSoft',
  'Amazon Corretto',
]

/**
 * Reads `java.specification.version` and `sun.arch.data.model` out of the output of
 * `java -XshowSettings:properties -version`. Returns undefined when either is missing or
 * unrecognizable, since a runtime that can't say what it is can't be matched to a bot.
 *
 * A runtime reporting a non-Windows `os.name` is refused too: under Wine, a Linux `java` picked
 * through the `Z:` drive runs and answers, but a bot on it can't reach BWAPI's Windows shared memory.
 */
export function parseJavaProperties(
  output: string,
): { major: number; architecture: BotArchitecture } | undefined {
  const properties = new Map<string, string>()
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*([a-zA-Z0-9_.]+)\s*=\s*(.*)$/.exec(line)
    if (match) {
      properties.set(match[1], match[2].trim())
    }
  }

  const version = properties.get('java.specification.version')
  const dataModel = properties.get('sun.arch.data.model')
  if (!version || !dataModel) {
    return undefined
  }
  const osName = properties.get('os.name')
  if (osName !== undefined && !osName.startsWith('Windows')) {
    return undefined
  }

  // Runtimes before 9 report their major version as `1.x`.
  const versionMatch = /^(?:1\.(\d+)|(\d+))/.exec(version)
  if (!versionMatch) {
    return undefined
  }
  const major = Number(versionMatch[1] ?? versionMatch[2])
  if (!Number.isSafeInteger(major) || major <= 0) {
    return undefined
  }

  let architecture: BotArchitecture
  if (dataModel === '64') {
    architecture = 'x86_64'
  } else if (dataModel === '32') {
    architecture = 'x86'
  } else {
    return undefined
  }

  return { major, architecture }
}

function runJava(javaPath: string): Promise<string> {
  return new Promise(resolve => {
    execFile(
      javaPath,
      ['-XshowSettings:properties', '-version'],
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        // The properties are printed on stderr, and a runtime that printed them has done its job
        // even if it then exited non-zero. Anything else reads as "not a usable runtime".
        const output = `${stdout}\n${stderr}`
        resolve(error && !output.includes('java.specification.version') ? '' : output)
      },
    )
  })
}

/**
 * Runs one `java.exe` and reports what it is, or undefined if it isn't usable. Candidates come
 * from directories anyone can put a file in, so a candidate that fails to run is an ordinary
 * outcome rather than an error.
 */
export async function probeJava(javaPath: string): Promise<JavaRuntimeInfo | undefined> {
  try {
    const parsed = parseJavaProperties(await runJava(javaPath))
    return parsed ? { path: javaPath, ...parsed } : undefined
  } catch {
    return undefined
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function subdirectoryBinaries(parent: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(parent, { withFileTypes: true })
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(parent, entry.name, 'bin', 'java.exe'))
  } catch {
    return []
  }
}

/**
 * Every `java.exe` worth probing: what `JAVA_HOME` and `PATH` point at, plus the standard vendor
 * install locations. Paths are deduplicated case-insensitively and only existing files are
 * returned.
 */
export async function findJavaCandidates(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const candidates: string[] = []

  if (env.JAVA_HOME) {
    candidates.push(path.join(env.JAVA_HOME, 'bin', 'java.exe'))
  }
  for (const entry of (env.PATH ?? '').split(path.delimiter)) {
    const trimmed = entry.trim().replace(/^"|"$/g, '')
    if (trimmed) {
      candidates.push(path.join(trimmed, 'java.exe'))
    }
  }

  const programFilesRoots = [env.ProgramFiles, env['ProgramFiles(x86)']].filter(
    (root): root is string => !!root,
  )
  for (const root of programFilesRoots) {
    for (const vendor of VENDOR_DIRECTORIES) {
      candidates.push(...(await subdirectoryBinaries(path.join(root, vendor))))
    }
  }

  const seen = new Set<string>()
  const found: string[] = []
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    const key = resolved.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    if (await isFile(resolved)) {
      found.push(resolved)
    }
  }
  return found
}

/** Caches a detected runtime set, since probing spawns a process per candidate. */
export class JavaDetector {
  private detected: JavaRuntimeInfo[] = []
  /** Wall-clock time of the last scan, for display. */
  private checkedAt?: number
  /** Monotonic time of the last scan, for the cache lifetime. */
  private scannedAt?: number
  private running?: Promise<JavaRuntimeInfo[]>

  getDetected(): JavaRuntimeInfo[] {
    return this.detected
  }

  getCheckedAt(): number | undefined {
    return this.checkedAt
  }

  /**
   * Returns the detected runtimes, rescanning when the cached set is older than
   * {@link JAVA_DETECTION_CACHE_MS} or when `force` is set. Concurrent scans are coalesced.
   */
  detect({ force = false }: { force?: boolean } = {}): Promise<JavaRuntimeInfo[]> {
    const fresh =
      this.scannedAt !== undefined && performance.now() - this.scannedAt < JAVA_DETECTION_CACHE_MS
    if (!force && fresh) {
      return Promise.resolve(this.detected)
    }
    if (this.running) {
      return this.running
    }

    this.running = (async () => {
      try {
        const candidates = await findJavaCandidates()
        const probed: JavaRuntimeInfo[] = []
        for (const candidate of candidates) {
          const info = await probeJava(candidate)
          if (info) {
            probed.push(info)
          }
        }
        this.detected = probed
        this.checkedAt = Date.now()
        this.scannedAt = performance.now()
        return probed
      } finally {
        this.running = undefined
      }
    })()
    return this.running
  }
}
