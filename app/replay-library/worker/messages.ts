import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
} from '../../../common/replays-library'

/**
 * The data handed to the replay DB worker at construction time (via `workerData`). `entry` is only
 * present in dev, where the launcher requires the worker module from source; the production bundle
 * is loaded directly and ignores it.
 */
export interface ReplayDbWorkerData {
  /** Absolute path to the worker's transpiled-at-runtime module. Dev-only (see above). */
  entry?: string
  /** Absolute path to the SQLite index file. */
  dbPath: string
  /** Absolute path to the replay folder to index (watched recursively). */
  watchedFolder: string
}

/** A page of query results, matching `ReplayDb.query`'s return shape. */
export interface ReplayQueryResult {
  entries: ReplayLibraryEntry[]
  total: number
}

// --- Main thread -> worker ---

export interface QueryRequest {
  type: 'query'
  /** Correlates the eventual `queryResult` back to the caller's pending request. */
  id: number
  filters: ReplayLibraryFilters
}

export interface StatusRequest {
  type: 'status'
  /** Correlates the eventual `statusResult` back to the caller's pending request. */
  id: number
}

export type ToWorkerMessage = QueryRequest | StatusRequest

// --- Worker -> main thread ---

/** Posted once the DB is open and the watcher has started; purely informational for logging. */
export interface ReadyMessage {
  type: 'ready'
}

export type QueryResultMessage = {
  type: 'queryResult'
  id: number
} & ({ result: ReplayQueryResult } | { error: Error })

export type StatusResultMessage = {
  type: 'statusResult'
  id: number
} & ({ status: ReplayLibraryStatus } | { error: Error })

/** Mirrors `ReplayWatcher`'s `onProgress`, forwarded to the renderer as `replayLibraryBackfillProgress`. */
export interface BackfillProgressMessage {
  type: 'backfillProgress'
  progress: { done: number; total: number }
}

/** Mirrors `ReplayWatcher`'s `onChange`, forwarded to the renderer as `replayLibraryChanged`. */
export interface ChangedMessage {
  type: 'changed'
}

/** A log line from the worker, written to the app log by the main thread (which owns the logger). */
export interface LogMessage {
  type: 'log'
  level: 'error' | 'warning' | 'verbose'
  message: string
}

export type FromWorkerMessage =
  | ReadyMessage
  | QueryResultMessage
  | StatusResultMessage
  | BackfillProgressMessage
  | ChangedMessage
  | LogMessage
