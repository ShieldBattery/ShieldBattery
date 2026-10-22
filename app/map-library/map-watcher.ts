import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import swallowNonBuiltins from '../../common/async/swallow-non-builtins'
import { getErrorStack } from '../../common/errors'
import { LocalMapIndexProgress, LocalMapInfo } from '../../common/map-library'
import { MAX_MAP_FILE_SIZE_BYTES } from '../../common/maps'
import { FolderWatchers } from '../folder-watchers'
import { isIndexedPathVanished } from '../replay-library/replay-watcher-paths'
import { MapDb } from './map-db'
import { folderForFile, isMapFilename, isSkippedTopLevelFolder, MapRootFolder } from './map-folders'

/** Debounce window for coalescing filesystem events into a single reconcile. */
const WATCH_DEBOUNCE_MS = 500
/**
 * How many files are read at once. Indexing reads every byte of every file (to hash it), so it's
 * bound by the disk; a little overlap helps, more just thrashes a hard disk.
 */
const INDEX_CONCURRENCY = 2
/**
 * Minimum time between change notifications while files are still being indexed, so a long first
 * index fills the list in progressively instead of only at the end.
 */
const CHANGE_NOTIFY_INTERVAL_MS = 1000
/** Minimum time between progress reports while indexing, which are forwarded to the renderer. */
const PROGRESS_INTERVAL_MS = 250
/** Base delay before re-running a failed reconcile, doubled on each consecutive failure. */
const RETRY_BASE_DELAY_MS = 2000
/** Cap on consecutive failed-reconcile retries, after which only filesystem events reconcile. */
const MAX_RETRY_ATTEMPTS = 5

interface FileMeta {
  mtime: number
  size: number
}

export interface MapWatcherCallbacks {
  /** Reports indexing progress; `undefined` means it finished (or had no work). */
  onProgress: (progress: LocalMapIndexProgress | undefined) => void
  onChange: () => void
}

/** The subset of the app logger the watcher needs (it runs in a worker thread, see `replay-watcher`). */
export interface MapLibraryLogger {
  error(message: string): void
  warning(message: string): void
  verbose(message: string): void
}

/** Reads map files for the watcher. Each one reads a single file at a time. */
export interface MapFileReader {
  /** Reads up to `size` bytes of the file and returns its hash (see `hashMapBytes`). */
  hash(filePath: string, size: number): Promise<string>
  /** Reads the facts of the file last hashed. Rejects if it isn't a readable map. */
  summarize(): Promise<LocalMapInfo>
  /** Releases what the reader holds. It can still be used afterwards. */
  close(): Promise<void>
}

/**
 * Watches the map folders and keeps the index reconciled with them: new and changed files are
 * hashed and read, and files that are gone are removed. A file whose contents were already read
 * under another path (a copy, or a moved file) reuses those facts instead of being read again.
 */
export class MapWatcher {
  private readonly folderWatchers: FolderWatchers
  private reconciling = false
  private reconcileQueued = false
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private retryAttempts = 0
  private progress: LocalMapIndexProgress | undefined
  private initialScanStarted = false

  /**
   * `createReader` provides a reader for each concurrent read of a reconcile; each is closed once
   * the reconcile is done with it.
   */
  constructor(
    private roots: ReadonlyArray<MapRootFolder>,
    private readonly db: MapDb,
    private readonly logger: MapLibraryLogger,
    private readonly callbacks: MapWatcherCallbacks,
    private readonly createReader: () => MapFileReader,
  ) {
    this.folderWatchers = new FolderWatchers(() => this.onWatchEvent(), logger)
  }

  getProgress(): LocalMapIndexProgress | undefined {
    return this.progress
  }

  getRoots(): MapRootFolder[] {
    return [...this.roots]
  }

  private emitProgress(progress: LocalMapIndexProgress | undefined): void {
    this.progress = progress
    this.callbacks.onProgress(progress)
  }

  start(): void {
    this.folderWatchers.setFolders(this.roots.map(r => r.path))
    this.reconcile().catch(swallowNonBuiltins)
  }

  stop(): void {
    this.folderWatchers.close()
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = undefined
    }
  }

  /** Swaps the indexed folders. The reconcile this starts prunes files under removed ones. */
  setRoots(roots: ReadonlyArray<MapRootFolder>): void {
    this.stop()
    this.roots = roots
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
   * single follow-up). Never rejects: failures are logged and a bounded, backed-off retry is
   * scheduled.
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
        this.logger.warning(`Failed to index ${failedCount} map file(s); scheduling a retry`)
        this.scheduleRetry()
      } else {
        this.retryAttempts = 0
        if (this.retryTimer) {
          clearTimeout(this.retryTimer)
          this.retryTimer = undefined
        }
      }
    } catch (err) {
      this.logger.error(`Error reconciling the map index: ${getErrorStack(err)}`)
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
        `Reconciling the map index failed ${this.retryAttempts} times in a row; ` +
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

  /** Returns the number of files whose index write failed. */
  private async runReconcile(): Promise<number> {
    if (!this.initialScanStarted) {
      this.initialScanStarted = true
      this.emitProgress({ phase: 'scanning' })
    }
    // Picks back up a watch that failed; this reconcile's scan covers whatever it missed
    this.folderWatchers.refresh({ notify: false })

    const { files, scannedRoots, unreadableDirs } = await this.scanMapFiles()
    // With folders configured but none readable (e.g. a missing install), the index is left as it
    // is rather than every file in it treated as deleted.
    if (this.roots.length > 0 && scannedRoots.length === 0) {
      this.emitProgress(undefined)
      return 0
    }

    const rootPaths = this.roots.map(r => r.path)
    const existing = this.db.getExisting()
    const scannedPaths = new Set(files.keys())
    const toDelete: string[] = []
    for (const existingPath of existing.keys()) {
      if (
        isIndexedPathVanished(existingPath, rootPaths, scannedRoots, scannedPaths, unreadableDirs)
      ) {
        toDelete.push(existingPath)
      }
    }

    const toIndex: string[] = []
    for (const [filePath, meta] of files) {
      const ex = existing.get(filePath)
      if (!ex || ex.fileMtime !== meta.mtime || ex.fileSize !== meta.size) {
        toIndex.push(filePath)
      }
    }
    if (toIndex.length === 0) {
      this.emitProgress(undefined)
      if (toDelete.length > 0) {
        this.db.deleteByPaths(toDelete)
        this.callbacks.onChange()
      }
      return 0
    }

    let done = 0
    let failedCount = 0
    const total = toIndex.length
    this.emitProgress({ phase: 'indexing', done, total })

    let nextIndex = 0
    let lastChangeNotify = Date.now()
    let lastProgress = Date.now()
    const worker = async () => {
      const reader = this.createReader()
      try {
        while (nextIndex < toIndex.length) {
          const filePath = toIndex[nextIndex]
          nextIndex++
          try {
            await this.indexFile(filePath, files.get(filePath)!, reader)
          } catch (err) {
            failedCount++
            this.logger.warning(`Error indexing map file '${filePath}': ${getErrorStack(err)}`)
          }
          done++
          const now = Date.now()
          if (done < total && now - lastProgress >= PROGRESS_INTERVAL_MS) {
            lastProgress = now
            this.emitProgress({ phase: 'indexing', done, total })
          }
          if (done < total && now - lastChangeNotify >= CHANGE_NOTIFY_INTERVAL_MS) {
            lastChangeNotify = now
            this.callbacks.onChange()
          }
        }
      } finally {
        await reader.close()
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(INDEX_CONCURRENCY, toIndex.length) }, () => worker()),
    )
    // Only now, so a file that moved finds the facts of its old path by hash while it's indexed
    if (toDelete.length > 0) {
      this.db.deleteByPaths(toDelete)
    }

    this.emitProgress(undefined)
    this.callbacks.onChange()
    return failedCount
  }

  private async indexFile(filePath: string, meta: FileMeta, reader: MapFileReader): Promise<void> {
    const folder = folderForFile(filePath, this.roots)
    if (folder === undefined) {
      return
    }

    let hash: string
    try {
      hash = await reader.hash(filePath, meta.size)
    } catch (err) {
      // The file likely vanished between the scan and now; a later reconcile catches up.
      this.logger.verbose(`Skipping map file '${filePath}': ${getErrorStack(err)}`)
      return
    }

    let map: LocalMapInfo | undefined = this.db.findMapInfoByHash(hash)
    if (!map) {
      try {
        map = await reader.summarize()
      } catch (err) {
        this.logger.verbose(`Map file '${filePath}' couldn't be read: ${getErrorStack(err)}`)
      }
    }

    // Outside the catch above: a failed database write must reach the caller (which schedules a
    // retry) instead of being taken for an unreadable file.
    this.db.upsertFile({
      path: filePath,
      folder,
      fileMtime: meta.mtime,
      fileSize: meta.size,
      hash,
      map,
    })
  }

  /**
   * Walks every root for map files, leaving out the skipped folders directly inside each root.
   * Reports which roots could be read and every folder that couldn't, so files indexed beneath an
   * unreadable folder are kept rather than taken for deleted.
   */
  private async scanMapFiles(): Promise<{
    files: Map<string, FileMeta>
    scannedRoots: string[]
    unreadableDirs: string[]
  }> {
    const result = new Map<string, FileMeta>()
    const scannedRoots: string[] = []
    const unreadableDirs: string[] = []

    const walk = async (dir: string, isRoot: boolean): Promise<boolean> => {
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
          if (!(isRoot && isSkippedTopLevelFolder(entry.name))) {
            await walk(full, false)
          }
        } else if (entry.isFile() && isMapFilename(entry.name)) {
          try {
            const s = await stat(full)
            // The server refuses larger files, so they could never be used
            if (s.size <= MAX_MAP_FILE_SIZE_BYTES) {
              result.set(full, { mtime: Math.floor(s.mtimeMs), size: s.size })
            }
          } catch {
            // The file vanished mid-scan
          }
        }
      }
      return true
    }

    for (const root of this.roots) {
      if (await walk(root.path, true)) {
        scannedRoots.push(root.path)
      }
    }
    if (unreadableDirs.length > 0) {
      this.logger.warning(
        `Could not read ${unreadableDirs.length} folder(s) while scanning for maps; ` +
          `their indexed maps are kept as they are: ${unreadableDirs.join(', ')}`,
      )
    }
    return { files: result, scannedRoots, unreadableDirs }
  }
}
