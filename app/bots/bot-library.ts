/**
 * The desktop app's bot library: the catalog cache, the packages installed on this PC, the local
 * builds a developer added, the Java runtimes available, and the learning profiles bots run from.
 *
 * Everything that touches a path or a process lives here rather than in the renderer: the renderer
 * chooses a bot, and this decides what that means on disk. Bots leased by a running game are
 * tracked so their files and learning data can't be changed underneath them.
 */

import { BrowserWindow, dialog, net, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  BotCatalogEntry,
  BotCatalogRelease,
  botRaceToRaceChar,
  BotRuntime,
} from '../../common/bots/bot-catalog'
import {
  AddedJavaRuntime,
  BotCatalogStatus,
  BotInstallFailure,
  BotInstallProgress,
  BotKey,
  BotLibrarySnapshot,
  CachedBotCatalog,
  InstalledBotRelease,
  isLocalBuildKey,
  JavaRuntimeInfo,
  LOCAL_BUILD_KEY_PREFIX,
  LocalBuildBot,
  LocalBuildBotSpec,
  PracticeBotSelection,
} from '../../common/bots/bot-library'
import { architectureLabel, findJavaRuntime } from '../../common/bots/bot-view'
import { PracticeLaunchRequest, PracticeStoreData } from '../../common/bots/practice'
import { LocalBotLaunch, LocalGameStatus } from '../../common/games/local-game'
import type { LocalGameManager } from '../game/local-game-manager'
import log from '../logger'
import { BotLeases } from './bot-leases'
import {
  canReplaceCachedCatalog,
  CATALOG_STALE_MS,
  fetchCatalog,
  isCachedCatalogUsable,
  resolveCatalogUrl,
} from './catalog'
import { CatalogTrust, resolveCatalogTrust } from './catalog-envelope'
import { installBotRelease } from './installer'
import { JavaDetector, probeJava } from './java-runtime'
import { readJsonFile } from './json-file'
import {
  ensureWorkingCopy,
  hasLearningData,
  ProfileBaseline,
  profileDirectoryName,
  profileRelativeWritablePath,
  resetLearning,
} from './learning-profiles'
import {
  BotLibraryData,
  emptyLibraryData,
  loadCachedCatalog,
  loadLibraryData,
  saveCachedCatalog,
  saveLibraryData,
} from './library-store'
import {
  checkLocalBuildPaths,
  defaultLocalBuildFormats,
  LOCAL_BUILD_DESCRIPTOR_NAME,
  parseLocalBuildDescriptor,
  validateLocalBuildSpec,
} from './local-builds'
import { resolveBotLaunchNames, sanitizeInGameName } from './naming'
import { loadPracticeStore, savePracticeStore } from './practice-store'

/** Largest license/notice file the app will read into the renderer. */
const MAX_NOTICE_BYTES = 1024 * 1024

export interface BotLibraryOptions {
  /** Directory holding everything the library keeps on disk. */
  dataRoot: string
  /** Where the local game manager writes per-session game logs. */
  localGameLogsRoot: string
  /** Development builds use the staging catalog; only they can launch local bot games at all. */
  isDev: boolean
  getLocalGameManager: () => LocalGameManager
  getParentWindow: () => BrowserWindow | null
  onChanged: (snapshot: BotLibrarySnapshot) => void
  onInstallProgress: (progress: BotInstallProgress) => void
}

function displayableError(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export class BotLibrary {
  private readonly botsRoot: string
  private readonly libraryPath: string
  private readonly catalogPath: string
  private readonly practicePath: string
  private readonly packagesRoot: string
  private readonly profilesRoot: string
  private readonly downloadsRoot: string
  private readonly catalogUrl: string
  private readonly catalogTrust: CatalogTrust

  private data: BotLibraryData = emptyLibraryData()
  private catalog?: CachedBotCatalog
  private catalogStatus: BotCatalogStatus = { refreshing: false }
  private refreshing?: Promise<void>
  private readonly installs = new Map<
    string,
    { progress: BotInstallProgress; controller: AbortController }
  >()
  private installFailures: BotInstallFailure[] = []
  private readonly java = new JavaDetector()
  /**
   * The last probe of each of `data.javaRuntimes`, keyed by lowercased path. An `undefined` value
   * means it was probed and didn't run; a path with no entry hasn't been probed yet this run.
   */
  private readonly addedJava = new Map<string, JavaRuntimeInfo | undefined>()
  private addedJavaProbe: Promise<void> = Promise.resolve()
  private readonly leases = new BotLeases()
  private learningKeys: BotKey[] = []
  /** The tail of each bot's queue of changes, present only while one is queued or running. */
  private readonly perBotWork = new Map<BotKey, Promise<unknown>>()
  private readonly initialized: Promise<void>

  constructor(private readonly options: BotLibraryOptions) {
    this.botsRoot = options.dataRoot
    this.libraryPath = path.join(this.botsRoot, 'library.json')
    this.catalogPath = path.join(this.botsRoot, 'catalog.json')
    this.practicePath = path.join(this.botsRoot, 'practice.json')
    this.packagesRoot = path.join(this.botsRoot, 'packages')
    this.profilesRoot = path.join(this.botsRoot, 'profiles')
    this.downloadsRoot = path.join(this.botsRoot, 'downloads')
    this.catalogUrl = resolveCatalogUrl({
      override: process.env.SB_BOT_CATALOG_URL,
      isDev: options.isDev,
    })
    this.catalogTrust = resolveCatalogTrust({ isDev: options.isDev })

    this.initialized = this.init().catch(err => {
      log.error(`Error initializing the bot library: ${displayableError(err)}`)
    })
  }

  private async init(): Promise<void> {
    const { data, dropped } = await loadLibraryData(this.libraryPath)
    this.data = data
    for (const reason of dropped) {
      log.warning(`Dropping a bot library record: ${reason}`)
    }

    try {
      const cached = await loadCachedCatalog(this.catalogPath, this.catalogTrust)
      if (isCachedCatalogUsable(cached, this.catalogUrl)) {
        this.catalog = cached
      } else if (cached) {
        log.verbose('Discarding a bot catalog cached from a different URL')
      }
    } catch (err) {
      log.warning(`Ignoring the cached bot catalog: ${displayableError(err)}`)
    }

    await this.refreshLearningKeys()
    this.broadcast()

    // Readiness for Java bots depends on what is installed on this PC, so find out without making
    // the first library request wait for a process spawn per candidate.
    this.addedJavaProbe = this.probeAddedJava()
    Promise.all([this.java.detect(), this.addedJavaProbe])
      .then(() => this.broadcast())
      .catch(err => log.warning(`Error detecting Java runtimes: ${displayableError(err)}`))
  }

  // ----- snapshots -------------------------------------------------------------------------

  getSnapshot(): BotLibrarySnapshot {
    return {
      catalog: this.catalog,
      catalogStatus: this.catalogStatus,
      installed: this.data.installed,
      localBuilds: this.data.localBuilds,
      installs: Array.from(this.installs.values(), install => install.progress),
      installFailures: this.installFailures,
      java: {
        detected: this.javaRuntimes(),
        added: this.data.javaRuntimes.map(javaPath => {
          const key = javaPath.toLowerCase()
          let status: AddedJavaRuntime['status'] = 'checking'
          if (this.addedJava.has(key)) {
            status = this.addedJava.get(key) ? 'usable' : 'unusable'
          }
          return { path: javaPath, status }
        }),
        checkedAt: this.java.getCheckedAt(),
        overrides: this.data.javaOverrides,
      },
      inUse: Array.from(this.leases.keys()),
      hasLearningData: this.learningKeys,
    }
  }

  private broadcast(): void {
    this.options.onChanged(this.getSnapshot())
  }

  /** Returns the current library, refreshing the catalog in the background when it is stale. */
  async get(): Promise<BotLibrarySnapshot> {
    await this.initialized
    const stale = !this.catalog || Date.now() - this.catalog.fetchedAt > CATALOG_STALE_MS
    if (stale && !this.refreshing) {
      this.refreshCatalog().catch(err =>
        log.warning(`Error refreshing the bot catalog: ${displayableError(err)}`),
      )
    }
    return this.getSnapshot()
  }

  // ----- catalog ---------------------------------------------------------------------------

  async refreshCatalog(): Promise<BotLibrarySnapshot> {
    await this.initialized
    if (!this.refreshing) {
      this.catalogStatus = { ...this.catalogStatus, refreshing: true }
      this.broadcast()
      this.refreshing = this.fetchAndCacheCatalog().finally(() => {
        this.refreshing = undefined
        this.catalogStatus = { ...this.catalogStatus, refreshing: false }
        this.broadcast()
      })
    }
    await this.refreshing
    return this.getSnapshot()
  }

  private async fetchAndCacheCatalog(): Promise<void> {
    try {
      const { document, catalog } = await fetchCatalog(
        this.catalogUrl,
        (input, init) => net.fetch(input instanceof URL ? String(input) : input, init),
        this.catalogTrust,
      )
      if (!canReplaceCachedCatalog(this.catalog, this.catalogUrl, catalog.revision)) {
        throw new Error('The downloaded bot catalog is older than the one already saved')
      }
      const fetchedAt = Date.now()
      await saveCachedCatalog(this.catalogPath, { fetchedAt, url: this.catalogUrl, document })
      this.catalog = {
        revision: catalog.revision,
        fetchedAt,
        url: this.catalogUrl,
        bots: catalog.bots,
      }
      this.catalogStatus = { refreshing: true }
    } catch (err) {
      const error = displayableError(err)
      log.warning(`Error downloading the bot catalog: ${error}`)
      this.catalogStatus = { refreshing: true, lastError: error }
    }
  }

  // ----- installing ------------------------------------------------------------------------

  private findCatalogRelease(
    botId: string,
    releaseId: string,
  ): { entry: BotCatalogEntry; release: BotCatalogRelease } | undefined {
    const entry = this.catalog?.bots.find(candidate => candidate.bot.id === botId)
    const release = entry?.releases.find(candidate => candidate.package.releaseId === releaseId)
    return entry && release ? { entry, release } : undefined
  }

  private packageDirectory(botId: string, releaseId: string): string {
    return path.join(this.packagesRoot, botId, releaseId)
  }

  /**
   * Queues a change to one bot behind any change already queued for it. Every change must run
   * through here and check the bot's lease inside `work`: a launch refuses a bot with a change
   * queued or running and takes its lease in the same step, so a change and a game never overlap.
   */
  private runForBot<T>(key: BotKey, work: () => Promise<T>): Promise<T> {
    const previous = this.perBotWork.get(key) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.then(
      () => undefined,
      () => undefined,
    )
    this.perBotWork.set(key, tail)
    tail
      .then(() => {
        // Only the last queued change clears the entry, so the map holds exactly the bots with
        // a change still queued or running.
        if (this.perBotWork.get(key) === tail) {
          this.perBotWork.delete(key)
        }
      })
      .catch(() => undefined)
    return next
  }

  private requireNotInUse(key: BotKey): void {
    if (this.leases.has(key)) {
      throw new Error('This bot is being used by a game right now')
    }
  }

  async install(botId: string, releaseId: string): Promise<void> {
    await this.initialized
    await this.runForBot(botId, async () => {
      this.requireNotInUse(botId)
      if (this.installs.has(botId)) {
        throw new Error('This bot is already downloading')
      }
      const found = this.findCatalogRelease(botId, releaseId)
      if (!found) {
        throw new Error(`That version of this bot isn't in the catalog any more`)
      }

      const controller = new AbortController()
      const progress: BotInstallProgress = {
        botId,
        releaseId,
        phase: 'downloading',
        receivedBytes: 0,
        totalBytes: found.release.artifact.sizeBytes,
      }
      this.installs.set(botId, { progress, controller })
      this.installFailures = this.installFailures.filter(failure => failure.botId !== botId)
      this.broadcast()

      const previous = this.data.installed.find(installed => installed.botId === botId)
      try {
        const { record } = await installBotRelease({
          entry: found.entry,
          release: found.release,
          packagesRoot: this.packagesRoot,
          downloadsRoot: this.downloadsRoot,
          fetchImpl: (input, init) => net.fetch(input as any, init as any),
          signal: controller.signal,
          onProgress: report => {
            progress.phase = report.phase
            progress.receivedBytes = report.receivedBytes
            progress.totalBytes = report.totalBytes
            this.options.onInstallProgress({ ...progress })
          },
        })

        this.data.installed = [
          ...this.data.installed.filter(installed => installed.botId !== botId),
          record,
        ]
        await this.save()

        if (previous && previous.releaseId !== record.releaseId) {
          await fs.rm(this.packageDirectory(botId, previous.releaseId), {
            recursive: true,
            force: true,
          })
        }
        await this.refreshLearningKeys()
      } catch (err) {
        if (controller.signal.aborted) {
          log.verbose(`Canceled the download of bot ${botId}`)
          return
        }
        const error = displayableError(err)
        log.error(`Error installing bot ${botId}: ${error}`)
        this.installFailures = [
          ...this.installFailures.filter(failure => failure.botId !== botId),
          {
            botId,
            releaseId,
            error,
            receivedBytes: progress.receivedBytes,
            totalBytes: progress.totalBytes,
            failedAt: Date.now(),
          },
        ]
        throw new Error(error, { cause: err })
      } finally {
        this.installs.delete(botId)
        this.broadcast()
      }
    })
  }

  async cancelInstall(botId: string): Promise<void> {
    await this.initialized
    this.installs.get(botId)?.controller.abort()
  }

  async clearInstallFailure(botId: string): Promise<void> {
    await this.initialized
    if (this.installFailures.some(failure => failure.botId === botId)) {
      this.installFailures = this.installFailures.filter(failure => failure.botId !== botId)
      this.broadcast()
    }
  }

  /** Removes an installed release's files. The bot's learning profile is deliberately kept. */
  async remove(botId: string): Promise<void> {
    await this.initialized
    await this.runForBot(botId, async () => {
      this.requireNotInUse(botId)
      if (this.installs.has(botId)) {
        throw new Error('This bot is downloading right now')
      }
      if (!this.data.installed.some(installed => installed.botId === botId)) {
        return
      }
      this.data.installed = this.data.installed.filter(installed => installed.botId !== botId)
      await this.save()
      await fs.rm(path.join(this.packagesRoot, botId), { recursive: true, force: true })
      await this.refreshLearningKeys()
      this.broadcast()
    })
  }

  // ----- local builds ----------------------------------------------------------------------

  async addLocalBuild(spec: LocalBuildBotSpec): Promise<LocalBuildBot> {
    await this.initialized
    const validated = validateLocalBuildSpec(spec)
    await checkLocalBuildPaths(validated)
    const now = Date.now()
    const build: LocalBuildBot = {
      key: `${LOCAL_BUILD_KEY_PREFIX}${randomUUID()}`,
      ...validated,
      formats: defaultLocalBuildFormats(),
      learning: {
        mode: 'unknown',
        notes: 'This bot was added from a local build, so what it saves between games is unknown.',
      },
      addedAt: now,
      updatedAt: now,
    }
    this.data.localBuilds = [...this.data.localBuilds, build]
    await this.save()
    this.broadcast()
    return build
  }

  async updateLocalBuild(key: BotKey, spec: LocalBuildBotSpec): Promise<LocalBuildBot> {
    await this.initialized
    return await this.runForBot(key, async () => {
      this.requireNotInUse(key)
      const existing = this.data.localBuilds.find(build => build.key === key)
      if (!existing) {
        throw new Error(`Couldn't find that bot`)
      }
      const validated = validateLocalBuildSpec(spec)
      await checkLocalBuildPaths(validated)
      const updated: LocalBuildBot = { ...existing, ...validated, updatedAt: Date.now() }
      this.data.localBuilds = this.data.localBuilds.map(build =>
        build.key === key ? updated : build,
      )
      await this.save()
      this.broadcast()
      return updated
    })
  }

  /** Forgets a local build. The developer's own files are never touched. */
  async removeLocalBuild(key: BotKey): Promise<void> {
    await this.initialized
    await this.runForBot(key, async () => {
      this.requireNotInUse(key)
      if (!this.data.localBuilds.some(build => build.key === key)) {
        return
      }
      this.data.localBuilds = this.data.localBuilds.filter(build => build.key !== key)
      delete this.data.javaOverrides[key]
      await this.save()
      this.broadcast()
    })
  }

  async pickLocalBuild(): Promise<
    { executable: string; spec: Partial<LocalBuildBotSpec> } | undefined
  > {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.parentWindow(), {
      title: 'Select a bot executable',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe', 'jar'] }],
    })
    if (canceled || !filePaths.length) {
      return undefined
    }

    const executable = filePaths[0]
    const directory = path.dirname(executable)
    let spec: Partial<LocalBuildBotSpec> = {}
    try {
      const descriptor = await readJsonFile(path.join(directory, LOCAL_BUILD_DESCRIPTOR_NAME))
      if (descriptor !== undefined) {
        spec = parseLocalBuildDescriptor(descriptor, directory)
      }
    } catch (err) {
      log.warning(`Ignoring an unreadable ${LOCAL_BUILD_DESCRIPTOR_NAME}: ${displayableError(err)}`)
    }

    if (!spec.name) {
      spec.name = sanitizeInGameName(path.basename(executable, path.extname(executable)))
    }
    if (!spec.workingDirectory) {
      spec.workingDirectory = directory
    }
    if (!spec.runtime && path.extname(executable).toLowerCase() === '.exe') {
      spec.runtime = { kind: 'native' }
    }
    return { executable, spec }
  }

  async pickDirectory(title: string): Promise<string | undefined> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.parentWindow(), {
      title,
      properties: ['openDirectory'],
    })
    return canceled || !filePaths.length ? undefined : filePaths[0]
  }

  async pickJava(): Promise<string | undefined> {
    const { canceled, filePaths } = await dialog.showOpenDialog(this.parentWindow(), {
      title: 'Select java.exe',
      properties: ['openFile'],
      filters: [{ name: 'Java runtime', extensions: ['exe'] }],
    })
    return canceled || !filePaths.length ? undefined : filePaths[0]
  }

  private parentWindow(): BrowserWindow {
    const window = this.options.getParentWindow()
    if (!window) {
      throw new Error('No window to open this dialog from')
    }
    return window
  }

  // ----- Java ------------------------------------------------------------------------------

  async detectJava(): Promise<JavaRuntimeInfo[]> {
    await this.initialized
    this.addedJavaProbe = this.probeAddedJava()
    await Promise.all([this.java.detect({ force: true }), this.addedJavaProbe])
    this.broadcast()
    return this.javaRuntimes()
  }

  /** Every usable runtime, the user's added ones first so `findJavaRuntime` prefers them. */
  private javaRuntimes(): JavaRuntimeInfo[] {
    const added = this.data.javaRuntimes.map(javaPath => javaPath.toLowerCase())
    const usable = added.flatMap(key => this.addedJava.get(key) ?? [])
    return [
      ...usable,
      ...this.java.getDetected().filter(java => !added.includes(java.path.toLowerCase())),
    ]
  }

  private isAddedJava(key: string): boolean {
    return this.data.javaRuntimes.some(existing => existing.toLowerCase() === key)
  }

  /**
   * Re-probes the added runtimes. Paths can be added or removed while this runs, so each result is
   * written back on its own, and only while its path is still in the list: a scan never drops a
   * runtime added during it or brings back one removed during it.
   */
  private async probeAddedJava(): Promise<void> {
    for (const javaPath of this.data.javaRuntimes) {
      const info = await probeJava(javaPath)
      const key = javaPath.toLowerCase()
      if (this.isAddedJava(key)) {
        this.addedJava.set(key, info)
      }
    }
  }

  /** Adds a `java.exe` for any bot needing its version and architecture to run with. */
  async addJava(javaPath: string): Promise<JavaRuntimeInfo> {
    await this.initialized
    if (!path.isAbsolute(javaPath)) {
      throw new Error('Choose a java.exe on this PC')
    }
    const probed = await probeJava(javaPath)
    if (!probed) {
      throw new Error(`That file didn't report itself as a Windows Java runtime`)
    }
    const key = javaPath.toLowerCase()
    this.addedJava.set(key, probed)
    if (!this.isAddedJava(key)) {
      this.data.javaRuntimes = [...this.data.javaRuntimes, javaPath]
      await this.save()
    }
    this.broadcast()
    return probed
  }

  async removeJava(javaPath: string): Promise<void> {
    await this.initialized
    const key = javaPath.toLowerCase()
    this.data.javaRuntimes = this.data.javaRuntimes.filter(
      existing => existing.toLowerCase() !== key,
    )
    this.addedJava.delete(key)
    await this.save()
    this.broadcast()
  }

  async setJavaOverride(key: BotKey, javaPath: string | undefined): Promise<void> {
    await this.initialized
    if (!javaPath) {
      if (this.data.javaOverrides[key]) {
        delete this.data.javaOverrides[key]
        await this.save()
        this.broadcast()
      }
      return
    }

    if (!path.isAbsolute(javaPath)) {
      throw new Error('Choose a java.exe on this PC')
    }
    const probed = await probeJava(javaPath)
    if (!probed) {
      throw new Error(`That file didn't report itself as a Windows Java runtime`)
    }
    this.data.javaOverrides[key] = javaPath
    await this.save()
    this.broadcast()
  }

  // ----- learning profiles -----------------------------------------------------------------

  private baselineFor(installed: InstalledBotRelease): ProfileBaseline {
    const packageDirectory = this.packageDirectory(installed.botId, installed.releaseId)
    const { workingDirectory } = installed.package.launch
    const writablePaths: string[] = []
    for (const writable of installed.package.writableDirectories) {
      const relative = profileRelativeWritablePath(workingDirectory, writable)
      if (relative !== undefined) {
        writablePaths.push(relative)
      }
    }
    return {
      directory:
        workingDirectory === '.'
          ? packageDirectory
          : path.resolve(packageDirectory, workingDirectory),
      writablePaths,
    }
  }

  private async refreshLearningKeys(): Promise<void> {
    const keys: BotKey[] = []
    for (const installed of this.data.installed) {
      try {
        if (
          await hasLearningData({
            profilesRoot: this.profilesRoot,
            key: installed.botId,
            baseline: this.baselineFor(installed),
          })
        ) {
          keys.push(installed.botId)
        }
      } catch (err) {
        log.warning(
          `Error checking the learning profile of ${installed.botId}: ${displayableError(err)}`,
        )
      }
    }
    this.learningKeys = keys
  }

  async resetLearning(key: BotKey): Promise<void> {
    await this.initialized
    await this.runForBot(key, async () => {
      this.requireNotInUse(key)
      if (isLocalBuildKey(key)) {
        throw new Error(
          `A local build has no packaged files to restore, so ShieldBattery can't reset it`,
        )
      }
      const installed = this.data.installed.find(candidate => candidate.botId === key)
      if (!installed) {
        throw new Error(`That bot isn't installed`)
      }
      await resetLearning({
        profilesRoot: this.profilesRoot,
        key,
        baseline: this.baselineFor(installed),
      })
      await this.refreshLearningKeys()
      this.broadcast()
    })
  }

  // ----- files -----------------------------------------------------------------------------

  async readNotice(botId: string, noticePath: string): Promise<string> {
    await this.initialized
    const installed = this.data.installed.find(candidate => candidate.botId === botId)
    if (!installed) {
      throw new Error(`That bot isn't installed`)
    }
    // Only the notices the package itself lists, so this can't be used to read the disk.
    const license = installed.package.licenses.find(
      candidate => candidate.noticePath === noticePath,
    )
    if (!license) {
      throw new Error(`That bot doesn't have that notice`)
    }
    const filePath = path.resolve(
      this.packageDirectory(installed.botId, installed.releaseId),
      license.noticePath,
    )
    const handle = await fs.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(MAX_NOTICE_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, MAX_NOTICE_BYTES, 0)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  }

  /**
   * Opens the folder a bot actually runs from: its learning profile once one exists, and its
   * installed package (or the developer's own folder) before that.
   */
  async openFolder(key: BotKey): Promise<void> {
    await this.initialized
    const profileWorkingCopy = path.join(this.profilesRoot, profileDirectoryName(key), 'work')
    let target: string | undefined
    try {
      if ((await fs.stat(profileWorkingCopy)).isDirectory()) {
        target = profileWorkingCopy
      }
    } catch {
      // No profile yet, fall back to wherever the bot's files live.
    }

    if (!target) {
      const build = this.data.localBuilds.find(candidate => candidate.key === key)
      const installed = this.data.installed.find(candidate => candidate.botId === key)
      if (build) {
        target = build.workingDirectory
      } else if (installed) {
        target = this.packageDirectory(installed.botId, installed.releaseId)
      }
    }
    if (!target) {
      throw new Error(`That bot doesn't have any files on this PC`)
    }

    const error = await shell.openPath(target)
    if (error) {
      throw new Error(error)
    }
  }

  /** Opens the log folder for one local game session, or the folder holding all of them. */
  async openLogs(sessionId?: string): Promise<void> {
    const root = this.options.localGameLogsRoot
    const target = sessionId ? path.join(root, sessionId) : root
    await fs.mkdir(target, { recursive: true })
    const error = await shell.openPath(target)
    if (error) {
      throw new Error(error)
    }
  }

  // ----- practice setup --------------------------------------------------------------------

  async loadPracticeStore(): Promise<PracticeStoreData | undefined> {
    try {
      return await loadPracticeStore(this.practicePath)
    } catch (err) {
      log.warning(`Ignoring the saved practice setup: ${displayableError(err)}`)
      return undefined
    }
  }

  async savePracticeStore(data: PracticeStoreData): Promise<void> {
    await savePracticeStore(this.practicePath, data)
  }

  // ----- launching -------------------------------------------------------------------------

  private resolveJava(key: BotKey, runtime: Extract<BotRuntime, { kind: 'java' }>, name: string) {
    const override = this.data.javaOverrides[key]
    if (override) {
      return override
    }
    const detected = findJavaRuntime(this.javaRuntimes(), runtime)
    if (!detected) {
      throw new Error(
        `${name} needs a ${architectureLabel(runtime.architecture)} Java ${runtime.major} ` +
          `runtime. Install one, or choose a java.exe for this bot.`,
      )
    }
    return detected.path
  }

  private async resolveSelection(
    selection: PracticeBotSelection,
    instanceIndex: number,
    names: { inGameName: string; replayName?: string },
  ): Promise<LocalBotLaunch> {
    const race = botRaceToRaceChar(selection.race)
    if (isLocalBuildKey(selection.key)) {
      const build = this.data.localBuilds.find(candidate => candidate.key === selection.key)
      if (!build) {
        throw new Error(`One of the chosen bots is no longer in your library`)
      }
      if (!build.races.includes(selection.race)) {
        throw new Error(`${build.name} can't play ${selection.race}`)
      }
      const executable =
        build.runtime.kind === 'java'
          ? this.resolveJava(build.key, build.runtime, build.name)
          : build.executable
      const args =
        build.runtime.kind === 'java'
          ? [...(build.runtime.jvmArguments ?? []), '-jar', build.executable, ...build.args]
          : build.args
      return {
        id: build.key,
        name: names.inGameName,
        replayName: names.replayName,
        race,
        executable,
        args,
        workingDirectory: build.workingDirectory,
      }
    }

    const installed = this.data.installed.find(candidate => candidate.botId === selection.key)
    if (!installed) {
      throw new Error(`One of the chosen bots isn't installed`)
    }
    if (selection.releaseId && installed.releaseId !== selection.releaseId) {
      throw new Error(`The chosen version of ${installed.bot.name} isn't installed`)
    }
    if (!installed.package.profile.selectableRaces.includes(selection.race)) {
      throw new Error(`${installed.bot.name} can't play ${selection.race}`)
    }

    const packageDirectory = this.packageDirectory(installed.botId, installed.releaseId)
    const entrypoint = path.resolve(packageDirectory, installed.package.launch.entrypoint)
    const workingDirectory = await ensureWorkingCopy({
      profilesRoot: this.profilesRoot,
      key: installed.botId,
      instanceIndex,
      baseline: this.baselineFor(installed),
    })
    const { runtime } = installed.package
    const executable =
      runtime.kind === 'java'
        ? this.resolveJava(installed.botId, runtime, installed.bot.name)
        : entrypoint
    const args =
      runtime.kind === 'java'
        ? [
            ...(runtime.jvmArguments ?? []),
            '-jar',
            entrypoint,
            ...installed.package.launch.arguments,
          ]
        : installed.package.launch.arguments

    return {
      id: installed.botId,
      name: names.inGameName,
      replayName: names.replayName,
      race,
      executable,
      args,
      workingDirectory,
    }
  }

  /**
   * Resolves every chosen bot into something launchable and starts the game. Resolution happens
   * before anything is launched, so a bot that can't run means no processes were started at all.
   */
  async startPracticeGame(request: PracticeLaunchRequest): Promise<LocalGameStatus> {
    await this.initialized
    if (!request?.bots?.length) {
      throw new Error('Choose at least one bot to play against')
    }
    // Resolution reads the packages and writes the learning profiles, so the bots must be leased
    // before it and nothing may be changing them. The check and the lease happen with no await
    // between them; from then on every change (see `runForBot`) finds the lease and refuses.
    const keys = new Set(request.bots.map(bot => bot.key))
    if (Array.from(keys).some(key => this.perBotWork.has(key))) {
      throw new Error(
        'One of the chosen bots is being changed right now. Try again once it finishes.',
      )
    }
    const lease = this.leases.acquire(keys)
    this.broadcast()

    const manager = this.options.getLocalGameManager()
    let status: LocalGameStatus
    try {
      // A Java bot's readiness depends on a scan that may not have finished yet this run.
      await Promise.all([this.java.detect(), this.addedJavaProbe])

      const sourceNames = request.bots.map(bot => {
        const build = this.data.localBuilds.find(candidate => candidate.key === bot.key)
        const installed = this.data.installed.find(candidate => candidate.botId === bot.key)
        return build?.name ?? installed?.bot.name
      })
      const names = resolveBotLaunchNames(
        request.player?.name,
        request.bots.map((bot, index) => ({
          inGameName: bot.inGameName,
          replayName: sourceNames[index],
        })),
      )

      const instanceCounts = new Map<BotKey, number>()
      const launches: LocalBotLaunch[] = []
      for (const [index, selection] of request.bots.entries()) {
        const instanceIndex = instanceCounts.get(selection.key) ?? 0
        instanceCounts.set(selection.key, instanceIndex + 1)
        launches.push(await this.resolveSelection(selection, instanceIndex, names[index]))
      }

      status = await manager.start({
        map: request.map,
        player: {
          name: sanitizeInGameName(request.player?.name),
          race: request.player?.race ?? 'r',
          observer: request.player?.observer === true,
        },
        gameType: request.gameType,
        bots: launches,
      })
    } catch (err) {
      await this.releaseLease(lease)
      throw err
    }

    const release = (sessionStatus: LocalGameStatus) => {
      if (sessionStatus.id !== status.id) {
        return
      }
      if (sessionStatus.state === 'finished' || sessionStatus.state === 'error') {
        manager.off('status', release)
        this.releaseLease(lease).catch(err =>
          log.error(`Error releasing bots after a game: ${displayableError(err)}`),
        )
      }
    }
    manager.on('status', release)
    // The session can already have ended while it was being started.
    const current = manager.getStatus()
    if (current) {
      release(current)
    }

    return status
  }

  private async releaseLease(lease: symbol): Promise<void> {
    if (this.leases.release(lease)) {
      // A game is the one thing that writes into a learning profile.
      await this.refreshLearningKeys()
      this.broadcast()
    }
  }

  /** Aborts in-flight downloads so a quitting app doesn't leave a half-written package behind. */
  shutdown(): void {
    for (const install of this.installs.values()) {
      install.controller.abort()
    }
  }

  private async save(): Promise<void> {
    await saveLibraryData(this.libraryPath, this.data)
  }
}
