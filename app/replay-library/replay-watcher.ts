import { FSWatcher, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { ReplayBackfillProgress } from '../../common/replays-library'
import { matchRenamedReplays, NewFileIdentity, VanishedReplay } from './rename-matcher'
import { ExistingReplayInfo, ReplayDb } from './replay-db'
import {
  computeContentHash,
  IndexedReplay,
  makeParseErrorRecord,
  parseReplayFile,
  ReplayFileInfo,
} from './replay-parser'
import { isIndexedPathVanished } from './replay-watcher-paths'

/** Debounce window for coalescing filesystem events into a single reconcile. */
const WATCH_DEBOUNCE_MS = 500
/**
 * How many replays are parsed concurrently during a backfill. Each parse streams the entire file
 * (SC:R sections like Sbat live near the end), so this is IO-bound and benefits from overlap; the
 * synchronous DB writes still serialize naturally on the event loop.
 */
const PARSE_CONCURRENCY = 8
/** Yield back to the event loop after parsing this many files, so indexing stays non-blocking. */
const PARSE_YIELD_EVERY = 8
/**
 * Minimum time between change notifications while a reconcile is still parsing, so a long
 * backfill fills the list in progressively instead of only at the end.
 */
const CHANGE_NOTIFY_INTERVAL_MS = 1000
/**
 * Base delay before re-running a reconcile that failed (wholly or for individual files), doubled
 * on each consecutive failure. Failures here are mostly transient database contention with another
 * app instance indexing the same folder, which clears quickly.
 */
const RETRY_BASE_DELAY_MS = 2000
/**
 * Cap on consecutive failed-reconcile retries. Past this, the index stays as-is until the next
 * filesystem event (which reconciles, and resets the count if it succeeds), so a persistent
 * failure can't retry-loop forever.
 */
const MAX_RETRY_ATTEMPTS = 5

interface FileMeta {
  mtime: number
  size: number
}

export interface ReplayWatcherCallbacks {
  /** Reports backfill progress; `undefined` means the backfill finished (or had no work). */
  onProgress: (progress: ReplayBackfillProgress | undefined) => void
  onChange: () => void
}

/**
 * The subset of the app logger the watcher needs. Injected rather than importing the app logger
 * directly because the watcher runs inside a worker thread, where the app logger's electron
 * main-thread-only APIs (`app.getVersion()`, `app.getPath()`) aren't available.
 */
export interface ReplayLibraryLogger {
  error(message: string): void
  warning(message: string): void
  verbose(message: string): void
}

/**
 * Watches the configured replay folders and keeps the index reconciled with disk. Reconciliation
 * (used both for the initial backfill and for change events) scans each configured root for `.rep`
 * files, parses new/changed ones, re-points moved/renamed files at their new path by content
 * identity instead of re-parsing them, and prunes entries for files that no longer exist.
 */
export class ReplayWatcher {
  private watchers: FSWatcher[] = []
  private watchedFolders: ReadonlyArray<string>
  private reconciling = false
  private reconcileQueued = false
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryAttempts = 0
  private backfillProgress: ReplayBackfillProgress | undefined
  /**
   * Whether the initial backfill has begun. The `scanning` phase is only surfaced for it: later,
   * watch-triggered reconciles re-scan every folder too, but their work is small and showing a
   * full "scanning" state on every added file would just flicker.
   */
  private initialScanStarted = false

  constructor(
    watchedFolders: ReadonlyArray<string>,
    private readonly db: ReplayDb,
    private readonly logger: ReplayLibraryLogger,
    private readonly callbacks: ReplayWatcherCallbacks,
  ) {
    this.watchedFolders = watchedFolders
  }

  /** Current backfill progress, or undefined when no reconcile with pending work is running. */
  getBackfillProgress(): ReplayBackfillProgress | undefined {
    return this.backfillProgress
  }

  /** The folders currently being watched (a fresh, mutable copy). */
  getWatchedFolders(): string[] {
    return [...this.watchedFolders]
  }

  /** Records the current backfill progress and notifies the renderer of the change. */
  private emitProgress(progress: ReplayBackfillProgress | undefined): void {
    this.backfillProgress = progress
    this.callbacks.onProgress(progress)
  }

  start(): void {
    this.reconcile().catch(swallowNonBuiltins)

    for (const folder of this.watchedFolders) {
      try {
        this.watchers.push(watch(folder, { recursive: true }, () => this.onWatchEvent()))
      } catch (err) {
        // Folder may not exist yet, or recursive watching may be unavailable; the index just stays
        // as last reconciled.
        this.logger.warning(`Could not watch replay folder '${folder}': ${getErrorStack(err)}`)
      }
    }
  }

  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /**
   * Swaps the set of watched folders. Restarting kicks off a reconcile, which prunes rows no longer
   * under any configured root and indexes any newly-added roots (content-hash rename matching
   * rescues files that physically moved between roots).
   */
  setWatchedFolders(folders: ReadonlyArray<string>): void {
    this.stop()
    this.watchedFolders = folders
    this.start()
  }

  private onWatchEvent(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.reconcile().catch(swallowNonBuiltins)
    }, WATCH_DEBOUNCE_MS)
  }

  /**
   * Runs a reconcile, serialized against other reconciles (a request during a running one queues a
   * single follow-up). Never rejects: failures — a thrown reconcile or individual files whose
   * index write failed — are logged and a bounded, backed-off retry is scheduled, since the usual
   * cause is transient database contention with another app instance and no further filesystem
   * event may arrive to trigger the reindex otherwise.
   */
  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileQueued = true
      return
    }
    this.reconciling = true
    try {
      const failedCount = await this.runReconcile()
      if (failedCount > 0) {
        this.logger.warning(`Failed to index ${failedCount} replay(s); scheduling a retry`)
        this.scheduleRetry()
      } else {
        this.retryAttempts = 0
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
          this.retryTimer = undefined
        }
      }
    } catch (err) {
      this.logger.error(`Error reconciling replay index: ${getErrorStack(err)}`)
      this.scheduleRetry()
    } finally {
      this.reconciling = false
      if (this.reconcileQueued) {
        this.reconcileQueued = false
        this.reconcile().catch(swallowNonBuiltins)
      }
    }
  }

  private scheduleRetry(): void {
    if (this.retryTimer) {
      return
    }
    if (this.retryAttempts >= MAX_RETRY_ATTEMPTS) {
      this.logger.error(
        `Reconciling the replay index failed ${this.retryAttempts} times in a row; ` +
          `waiting for further filesystem changes`,
      )
      return
    }
    this.retryAttempts += 1
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined
        this.reconcile().catch(swallowNonBuiltins)
      },
      RETRY_BASE_DELAY_MS * 2 ** (this.retryAttempts - 1),
    )
  }

  /** Returns the number of files whose index write failed (they remain unindexed on disk). */
  private async runReconcile(): Promise<number> {
    // Surface a "scanning" state only for the very first reconcile, before we know how much work
    // there is; the folder walk over a large library is slow enough to be worth showing.
    const isInitial = !this.initialScanStarted
    this.initialScanStarted = true
    if (isInitial) {
      this.emitProgress({ phase: 'scanning' })
    }

    const { files, scannedRoots, unreadableDirs } = await this.scanReplayFiles()

    // If folders are configured but not a single one could be read (e.g. every folder is missing or
    // on an offline drive), leave the whole index untouched rather than treating every entry as
    // deleted. With zero configured folders this guard must NOT fire: the reconcile has to proceed
    // so every indexed row (now under no configured root) is pruned.
    if (this.watchedFolders.length > 0 && scannedRoots.length === 0) {
      this.emitProgress(undefined)
      return 0
    }

    const existing = this.db.getExistingReplays()

    // A directory that's temporarily unreadable (offline/unplugged drive, permission blip,
    // unavailable network mount) must NOT prune its rows: doing so would cascade away the bookmarks
    // and playlist memberships of replays that still exist. So a row is only pruned when its root
    // was removed from settings, or when every directory on the way down to it was readable this
    // reconcile yet the scan didn't find it. See `isIndexedPathVanished`.
    const scannedPaths = new Set(files.keys())
    const vanished = new Map<string, ExistingReplayInfo>()
    for (const [existingPath, info] of existing) {
      if (
        isIndexedPathVanished(
          existingPath,
          this.watchedFolders,
          scannedRoots,
          scannedPaths,
          unreadableDirs,
        )
      ) {
        vanished.set(existingPath, info)
      }
    }

    let toParse: string[] = []
    const newFilePaths: string[] = []
    for (const [filePath, meta] of files) {
      const ex = existing.get(filePath)
      if (!ex || ex.fileMtime !== meta.mtime || ex.fileSize !== meta.size) {
        toParse.push(filePath)
        if (!ex) {
          newFilePaths.push(filePath)
        }
      }
    }

    // Precomputed hashes for brand-new files, filled in below when there's a chance they're
    // actually moved/renamed replays; threaded through to `indexFile` either way so a file hashed
    // here is never hashed again during parsing.
    const hashes = new Map<string, string>()
    let moveCount = 0
    if (vanished.size > 0 && newFilePaths.length > 0) {
      let nextHashIndex = 0
      const hashWorker = async () => {
        while (nextHashIndex < newFilePaths.length) {
          const filePath = newFilePaths[nextHashIndex]
          nextHashIndex++
          try {
            hashes.set(filePath, await computeContentHash(filePath))
          } catch {
            // File likely vanished mid-scan; it'll be handled (and skipped) by the parse loop.
          }
        }
      }
      await Promise.all(
        Array.from({ length: Math.min(PARSE_CONCURRENCY, newFilePaths.length) }, () =>
          hashWorker(),
        ),
      )

      const vanishedList: VanishedReplay[] = Array.from(vanished, ([vpath, info]) => ({
        path: vpath,
        id: info.id,
        fileSize: info.fileSize,
        contentHash: info.contentHash,
      }))
      const newFileIdentities: NewFileIdentity[] = Array.from(hashes, ([npath, contentHash]) => ({
        path: npath,
        contentHash,
        fileSize: files.get(npath)!.size,
      }))
      const moves = matchRenamedReplays(vanishedList, newFileIdentities)

      const movedToPaths = new Set<string>()
      for (const move of moves) {
        this.db.updateReplayFile(move.id, move.toPath, files.get(move.toPath)!.mtime)
        vanished.delete(move.fromPath)
        movedToPaths.add(move.toPath)
      }
      if (movedToPaths.size > 0) {
        toParse = toParse.filter(p => !movedToPaths.has(p))
      }
      moveCount = moves.length
      if (moveCount > 0) {
        this.logger.verbose(`Re-pointed ${moveCount} moved/renamed replay(s)`)
      }
    }

    const toDelete = Array.from(vanished.keys())
    if (toDelete.length > 0) {
      this.db.deleteByPaths(toDelete)
    }

    if (toParse.length === 0) {
      this.emitProgress(undefined)
      if (toDelete.length > 0 || moveCount > 0) {
        this.callbacks.onChange()
      }
      return 0
    }

    let done = 0
    let failedCount = 0
    const total = toParse.length
    this.emitProgress({ phase: 'indexing', done, total })

    let nextIndex = 0
    let lastChangeNotify = Date.now()
    const worker = async () => {
      while (nextIndex < toParse.length) {
        const filePath = toParse[nextIndex]
        nextIndex++
        try {
          await this.indexFile(filePath, files.get(filePath)!, hashes.get(filePath))
        } catch (err) {
          // A failed database write leaves this file unindexed but still on disk, so the retry
          // reconcile our caller schedules will pick it up again; meanwhile the other files still
          // get their chance to index.
          failedCount++
          this.logger.warning(`Error indexing replay '${filePath}': ${getErrorStack(err)}`)
        }
        done++
        if (done % PARSE_YIELD_EVERY === 0 || done === total) {
          if (done < total) {
            this.emitProgress({ phase: 'indexing', done, total })
            if (Date.now() - lastChangeNotify >= CHANGE_NOTIFY_INTERVAL_MS) {
              lastChangeNotify = Date.now()
              this.callbacks.onChange()
            }
          }
          await new Promise<void>(resolve => setImmediate(resolve))
        }
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(PARSE_CONCURRENCY, toParse.length) }, () => worker()),
    )

    this.emitProgress(undefined)
    this.callbacks.onChange()
    return failedCount
  }

  private async indexFile(
    filePath: string,
    meta: FileMeta,
    precomputedHash?: string,
  ): Promise<void> {
    let fileInfo: ReplayFileInfo
    try {
      const contentHash = precomputedHash ?? (await computeContentHash(filePath))
      fileInfo = { path: filePath, fileMtime: meta.mtime, fileSize: meta.size, contentHash }
    } catch (err) {
      // File likely vanished between the scan and hashing; a later reconcile will catch up.
      this.logger.verbose(`Skipping replay '${filePath}': ${getErrorStack(err)}`)
      return
    }

    let record: IndexedReplay
    try {
      record = await parseReplayFile(fileInfo)
    } catch (err) {
      this.logger.verbose(`Indexing replay '${filePath}' as a parse error: ${getErrorStack(err)}`)
      record = makeParseErrorRecord(fileInfo)
    }

    // Outside the catch above: only a *parse* failure may be recorded as a parse error. A database
    // error must propagate to the caller instead — recording it as a parse error would store a row
    // whose mtime/size match the file, permanently hiding a replay that was never unreadable.
    this.db.upsertReplay(record)
  }

  /**
   * Walks every configured root into one union map keyed by absolute path (so overlapping roots
   * dedupe naturally). Also reports which roots were scannable: a root counts as scanned when its
   * top-level read succeeds. Every directory whose read failed — a root or a subfolder encountered
   * mid-walk — is reported in `unreadableDirs`, so already-indexed rows beneath it can be protected
   * from pruning (its files being absent from the scan proves nothing about their existence).
   */
  private async scanReplayFiles(): Promise<{
    files: Map<string, FileMeta>
    scannedRoots: string[]
    unreadableDirs: string[]
  }> {
    const result = new Map<string, FileMeta>()
    const scannedRoots: string[] = []
    const unreadableDirs: string[] = []

    // Returns whether `dir` itself could be read.
    const walk = async (dir: string): Promise<boolean> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        unreadableDirs.push(dir)
        return false
      }

      for (const entry of entries) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.rep')) {
          try {
            const s = await stat(full)
            result.set(full, { mtime: Math.floor(s.mtimeMs), size: s.size })
          } catch {
            // File vanished mid-scan; skip it.
          }
        }
      }
      return true
    }

    for (const root of this.watchedFolders) {
      if (await walk(root)) {
        scannedRoots.push(root)
      }
    }
    if (unreadableDirs.length > 0) {
      this.logger.warning(
        `Could not read ${unreadableDirs.length} folder(s) during replay scan; ` +
          `their indexed replays will be kept as-is: ${unreadableDirs.join(', ')}`,
      )
    }
    return { files: result, scannedRoots, unreadableDirs }
  }
}
