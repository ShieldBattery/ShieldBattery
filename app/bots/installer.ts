/**
 * Installing a catalog release: download, verify, extract, promote.
 *
 * Everything an install touches comes from the network, so the order matters. Bytes are written to
 * a scratch file and hashed before anything is unpacked, the archive is unpacked into a staging
 * directory whose every entry is checked first, and the finished directory is only moved into
 * place once the package descriptor inside it has been proven to be the one the catalog described.
 * A failure at any point leaves the previously installed release exactly as it was.
 */

import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import path from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { isDeepStrictEqual } from 'node:util'
import { Entry, open as openZip, ZipFile } from 'yauzl'
import { BotCatalogEntry, BotCatalogRelease, BotPackage } from '../../common/bots/bot-catalog'
import { BotInstallPhase, InstalledBotRelease } from '../../common/bots/bot-library'
import { validateBotPackage } from './catalog'
import { ZipEntryGuard } from './zip-safety'

/** The package descriptor every package archive carries at its root. */
export const PACKAGE_DESCRIPTOR_NAME = 'package.json'

/** Progress is reported at most this often, so a fast download can't flood the renderer. */
const PROGRESS_INTERVAL_MS = 250

export interface InstallProgressReport {
  phase: BotInstallPhase
  receivedBytes: number
  totalBytes: number
}

export interface InstallOptions {
  entry: BotCatalogEntry
  release: BotCatalogRelease
  /** `<userData>/bots/packages`. */
  packagesRoot: string
  /** `<userData>/bots/downloads`. */
  downloadsRoot: string
  fetchImpl: typeof globalThis.fetch
  signal: AbortSignal
  onProgress: (report: InstallProgressReport) => void
}

export interface InstallResult {
  record: InstalledBotRelease
  /** Where the package was promoted to. */
  packageDirectory: string
}

function randomSuffix(): string {
  return Math.floor(Math.random() * 0xffffffff)
    .toString(16)
    .padStart(8, '0')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.stat(target)
    return true
  } catch {
    return false
  }
}

async function downloadArchive({
  release,
  destination,
  fetchImpl,
  signal,
  onProgress,
}: {
  release: BotCatalogRelease
  destination: string
  fetchImpl: typeof globalThis.fetch
  signal: AbortSignal
  onProgress: (report: InstallProgressReport) => void
}): Promise<void> {
  const total = release.artifact.sizeBytes
  const response = await fetchImpl(release.artifact.url, { signal })
  if (!response.ok) {
    throw new Error(`Couldn't download this bot (${response.status})`)
  }
  if (!response.body) {
    throw new Error(`Couldn't download this bot (the response had no body)`)
  }

  const hash = createHash('sha256')
  let received = 0
  let lastReport = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length
      if (received > total) {
        callback(new Error('This bot download is larger than the catalog says it should be'))
        return
      }
      hash.update(chunk)
      const now = performance.now()
      if (now - lastReport >= PROGRESS_INTERVAL_MS) {
        lastReport = now
        onProgress({ phase: 'downloading', receivedBytes: received, totalBytes: total })
      }
      callback(null, chunk)
    },
  })

  await pipeline(
    Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
    meter,
    createWriteStream(destination),
  )

  onProgress({ phase: 'verifying', receivedBytes: received, totalBytes: total })
  if (received !== total) {
    throw new Error('This bot download ended early')
  }
  const digest = hash.digest('hex')
  if (digest !== release.artifact.sha256) {
    throw new Error(`This bot download doesn't match the catalog's checksum`)
  }
}

function openArchive(zipPath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    openZip(
      zipPath,
      // Backslash separators are handled by the entry checks rather than rejected outright, and
      // every other name rule is checked there too.
      { lazyEntries: true, autoClose: true, decodeStrings: true, strictFileNames: false },
      (err, zipFile) => {
        if (err || !zipFile) {
          reject(err ?? new Error(`Couldn't read this bot's archive`))
        } else {
          resolve(zipFile)
        }
      },
    )
  })
}

function openEntryStream(zipFile: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error(`Couldn't read an entry in this bot's archive`))
      } else {
        resolve(stream)
      }
    })
  })
}

async function extractEntry(
  zipFile: ZipFile,
  entry: Entry,
  destination: string,
  relativePath: string,
): Promise<void> {
  const target = path.resolve(destination, relativePath)
  if (target !== destination && !target.startsWith(destination + path.sep)) {
    throw new Error(`This bot's archive writes outside its own folder`)
  }
  await fs.mkdir(path.dirname(target), { recursive: true })

  let written = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length
      if (written > entry.uncompressedSize) {
        callback(new Error(`An entry in this bot's archive is bigger than it claims`))
        return
      }
      callback(null, chunk)
    },
  })
  await pipeline(await openEntryStream(zipFile, entry), meter, createWriteStream(target))
  if (written !== entry.uncompressedSize) {
    throw new Error(`An entry in this bot's archive is smaller than it claims`)
  }
}

/** Unpacks an archive into `destination`, rejecting any entry that breaks the package rules. */
export async function extractArchive({
  zipPath,
  destination,
  archiveSizeBytes,
}: {
  zipPath: string
  destination: string
  archiveSizeBytes: number
}): Promise<void> {
  const guard = new ZipEntryGuard(archiveSizeBytes)
  const zipFile = await openArchive(zipPath)
  const handleEntry = async (entry: Entry) => {
    const checked = guard.check({
      fileName: entry.fileName,
      uncompressedSize: entry.uncompressedSize,
      externalFileAttributes: entry.externalFileAttributes,
    })
    if (!checked.isDirectory) {
      await extractEntry(zipFile, entry, destination, checked.path)
      return
    }
    const target = path.resolve(destination, checked.path)
    if (!target.startsWith(destination + path.sep)) {
      throw new Error(`This bot's archive writes outside its own folder`)
    }
    await fs.mkdir(target, { recursive: true })
  }

  try {
    await new Promise<void>((resolve, reject) => {
      zipFile.on('error', reject)
      zipFile.on('end', resolve)
      zipFile.on('entry', (entry: Entry) => {
        handleEntry(entry).then(
          () => zipFile.readEntry(),
          (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
        )
      })
      zipFile.readEntry()
    })
  } finally {
    zipFile.close()
  }
}

/**
 * Proves an extracted package is the one the catalog described: the descriptor's bytes hash to the
 * manifest digest the catalog published, its contents are the catalog's package descriptor, and
 * the files it names are present.
 */
async function verifyPackageContents(
  packageDirectory: string,
  release: BotCatalogRelease,
): Promise<void> {
  const descriptorPath = path.join(packageDirectory, PACKAGE_DESCRIPTOR_NAME)
  let descriptorBytes: Buffer
  try {
    descriptorBytes = await fs.readFile(descriptorPath)
  } catch {
    throw new Error(`This bot's archive has no ${PACKAGE_DESCRIPTOR_NAME}`)
  }
  const digest = createHash('sha256').update(descriptorBytes).digest('hex')
  if (digest !== release.artifact.manifestSha256) {
    throw new Error(`This bot's package description doesn't match the catalog's checksum`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(descriptorBytes.toString('utf8'))
  } catch {
    throw new Error(`This bot's package description isn't valid JSON`)
  }
  // Both sides are compared in validated form, so optional fields that are simply absent on one
  // side and undefined on the other don't count as a difference.
  let descriptor: BotPackage
  try {
    descriptor = validateBotPackage(parsed, 'package', release.package.botId)
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`This bot's package description is invalid (${reason})`, { cause: err })
  }
  if (!isDeepStrictEqual(descriptor, release.package)) {
    throw new Error(`This bot's package description doesn't match the catalog`)
  }

  const entrypoint = path.resolve(packageDirectory, release.package.launch.entrypoint)
  const expectedExtension = release.package.runtime.kind === 'java' ? '.jar' : '.exe'
  if (path.extname(entrypoint).toLowerCase() !== expectedExtension) {
    throw new Error(`This bot doesn't launch from a ${expectedExtension} file`)
  }
  if (!(await pathExists(entrypoint))) {
    throw new Error(`This bot's archive is missing ${release.package.launch.entrypoint}`)
  }

  const workingDirectory =
    release.package.launch.workingDirectory === '.'
      ? packageDirectory
      : path.resolve(packageDirectory, release.package.launch.workingDirectory)
  if (!(await pathExists(workingDirectory))) {
    throw new Error(`This bot's archive is missing ${release.package.launch.workingDirectory}`)
  }

  for (const license of release.package.licenses) {
    if (!(await pathExists(path.resolve(packageDirectory, license.noticePath)))) {
      throw new Error(`This bot's archive is missing its ${license.name} notice`)
    }
  }
}

/**
 * Downloads and installs one release, returning the record to commit. The caller owns the library
 * file, so nothing is recorded here; the promoted package directory is complete and verified by
 * the time this resolves.
 */
export async function installBotRelease({
  entry,
  release,
  packagesRoot,
  downloadsRoot,
  fetchImpl,
  signal,
  onProgress,
}: InstallOptions): Promise<InstallResult> {
  const { botId, releaseId } = release.package
  const botPackagesDirectory = path.join(packagesRoot, botId)
  const packageDirectory = path.join(botPackagesDirectory, releaseId)
  const staging = path.join(botPackagesDirectory, `${releaseId}.staging-${randomSuffix()}`)
  const downloadPath = path.join(downloadsRoot, `${botId}-${releaseId}.zip.part`)

  await fs.mkdir(downloadsRoot, { recursive: true })
  await fs.mkdir(botPackagesDirectory, { recursive: true })

  try {
    onProgress({ phase: 'downloading', receivedBytes: 0, totalBytes: release.artifact.sizeBytes })
    await downloadArchive({ release, destination: downloadPath, fetchImpl, signal, onProgress })
    signal.throwIfAborted()

    onProgress({
      phase: 'installing',
      receivedBytes: release.artifact.sizeBytes,
      totalBytes: release.artifact.sizeBytes,
    })
    await fs.rm(staging, { recursive: true, force: true })
    await fs.mkdir(staging, { recursive: true })
    await extractArchive({
      zipPath: downloadPath,
      destination: staging,
      archiveSizeBytes: release.artifact.sizeBytes,
    })
    signal.throwIfAborted()
    await verifyPackageContents(staging, release)
    signal.throwIfAborted()

    // Replacing the same release's directory is the one case where an existing package is removed
    // before the new one is in place; a different release keeps its directory until the library
    // records the new one.
    await fs.rm(packageDirectory, { recursive: true, force: true })
    await fs.rename(staging, packageDirectory)
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true })
    throw err
  } finally {
    await fs.rm(downloadPath, { force: true })
  }

  return {
    record: {
      botId,
      releaseId,
      version: release.package.version,
      installedAt: Date.now(),
      sizeBytes: release.artifact.sizeBytes,
      digest: release.artifact.sha256,
      bot: entry.bot,
      package: release.package,
    },
    packageDirectory,
  }
}
