import { FSWatcher, watch } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { getErrorStack } from '../../common/errors'
import log from '../logger'
import { ReplayDb } from './replay-db'
import {
  computeContentHash,
  makeParseErrorRecord,
  parseReplayFile,
  ReplayFileInfo,
} from './replay-parser'

/** Debounce window for coalescing filesystem events into a single reconcile. */
const WATCH_DEBOUNCE_MS = 500
/** Yield back to the event loop after parsing this many files, so indexing stays non-blocking. */
const PARSE_YIELD_EVERY = 8

interface FileMeta {
  mtime: number
  size: number
}

export interface ReplayWatcherCallbacks {
  onProgress: (progress: { done: number; total: number }) => void
  onChange: () => void
}

/**
 * Watches the replay folder and keeps the index reconciled with disk. Reconciliation (used both for
 * the initial backfill and for change events) scans for `.rep` files, parses new/changed ones, and
 * prunes entries for files that no longer exist.
 */
export class ReplayWatcher {
  private watcher: FSWatcher | undefined
  private reconciling = false
  private reconcileQueued = false
  private debounceTimer: ReturnType<typeof setTimeout> | undefined
  private backfillProgress: { done: number; total: number } | undefined

  constructor(
    private readonly watchedFolder: string,
    private readonly db: ReplayDb,
    private readonly callbacks: ReplayWatcherCallbacks,
  ) {}

  /** Current backfill progress, or undefined when no reconcile with pending work is running. */
  getBackfillProgress(): { done: number; total: number } | undefined {
    return this.backfillProgress
  }

  start(): void {
    this.reconcile().catch(err => {
      log.error(`Error during initial replay backfill: ${getErrorStack(err)}`)
    })

    try {
      this.watcher = watch(this.watchedFolder, { recursive: true }, () => this.onWatchEvent())
    } catch (err) {
      // Folder may not exist yet, or recursive watching may be unavailable; the index just stays as
      // last reconciled.
      log.warning(`Could not watch replay folder '${this.watchedFolder}': ${getErrorStack(err)}`)
    }
  }

  stop(): void {
    this.watcher?.close()
    this.watcher = undefined
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = undefined
    }
  }

  private onWatchEvent(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined
      this.reconcile().catch(err => {
        log.error(`Error reconciling replay index: ${getErrorStack(err)}`)
      })
    }, WATCH_DEBOUNCE_MS)
  }

  private async reconcile(): Promise<void> {
    if (this.reconciling) {
      this.reconcileQueued = true
      return
    }
    this.reconciling = true
    try {
      await this.runReconcile()
    } finally {
      this.reconciling = false
      if (this.reconcileQueued) {
        this.reconcileQueued = false
        this.reconcile().catch(err => {
          log.error(`Error reconciling replay index: ${getErrorStack(err)}`)
        })
      }
    }
  }

  private async runReconcile(): Promise<void> {
    // If the watched folder can't be read at all (e.g. it doesn't exist), leave the index untouched
    // rather than treating every entry as deleted.
    try {
      await readdir(this.watchedFolder)
    } catch {
      this.backfillProgress = undefined
      return
    }

    const files = await this.scanReplayFiles()
    const existing = this.db.getExistingReplays()

    const toDelete: string[] = []
    for (const existingPath of existing.keys()) {
      if (!files.has(existingPath)) {
        toDelete.push(existingPath)
      }
    }
    if (toDelete.length > 0) {
      this.db.deleteByPaths(toDelete)
    }

    const toParse: string[] = []
    for (const [filePath, meta] of files) {
      const ex = existing.get(filePath)
      if (!ex || ex.fileMtime !== meta.mtime || ex.fileSize !== meta.size) {
        toParse.push(filePath)
      }
    }

    if (toParse.length === 0) {
      this.backfillProgress = undefined
      if (toDelete.length > 0) {
        this.callbacks.onChange()
      }
      return
    }

    let done = 0
    const total = toParse.length
    this.backfillProgress = { done, total }
    this.callbacks.onProgress({ done, total })

    for (const filePath of toParse) {
      await this.indexFile(filePath, files.get(filePath)!)
      done++
      if (done % PARSE_YIELD_EVERY === 0 || done === total) {
        this.backfillProgress = done < total ? { done, total } : undefined
        this.callbacks.onProgress({ done, total })
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }

    this.backfillProgress = undefined
    this.callbacks.onChange()
  }

  private async indexFile(filePath: string, meta: FileMeta): Promise<void> {
    let fileInfo: ReplayFileInfo
    try {
      const contentHash = await computeContentHash(filePath)
      fileInfo = { path: filePath, fileMtime: meta.mtime, fileSize: meta.size, contentHash }
    } catch (err) {
      // File likely vanished between the scan and hashing; a later reconcile will catch up.
      log.verbose(`Skipping replay '${filePath}': ${getErrorStack(err)}`)
      return
    }

    try {
      this.db.upsertReplay(await parseReplayFile(fileInfo))
    } catch (err) {
      log.verbose(`Indexing replay '${filePath}' as a parse error: ${getErrorStack(err)}`)
      this.db.upsertReplay(makeParseErrorRecord(fileInfo))
    }
  }

  private async scanReplayFiles(): Promise<Map<string, FileMeta>> {
    const result = new Map<string, FileMeta>()

    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch {
        // A subfolder may be inaccessible or removed mid-scan; skip it.
        return
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
    }

    await walk(this.watchedFolder)
    return result
  }
}
