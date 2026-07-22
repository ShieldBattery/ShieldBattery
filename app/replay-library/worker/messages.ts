import {
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
  ReplayPlaylist,
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

/**
 * The operations the main thread can invoke on the worker, each mirroring a synchronous method of
 * the worker-side DB. The worker runs the method and answers with a `CallResultMessage`; adding an
 * operation here means implementing it in the worker's `calls` table.
 */
export interface ReplayDbCalls {
  query: (filters: ReplayLibraryFilters) => ReplayQueryResult
  status: () => ReplayLibraryStatus
  setStarred: (replayId: number, starred: boolean) => void
  listPlaylists: () => ReplayPlaylist[]
  createPlaylist: (name: string) => number
  renamePlaylist: (playlistId: number, name: string) => void
  deletePlaylist: (playlistId: number) => void
  addToPlaylist: (playlistId: number, replayIds: number[]) => void
  removeFromPlaylist: (playlistId: number, replayIds: number[]) => void
  movePlaylistEntry: (playlistId: number, replayId: number, toIndex: number) => void
  getPlaylistsForReplay: (replayId: number) => Array<{ id: number; name: string }>
  findReplayIdByGameId: (gameId: string) => number | undefined
}

// --- Main thread -> worker ---

/**
 * A request to run one of `ReplayDbCalls` in the worker. `id` correlates the eventual
 * `CallResultMessage` back to the caller's pending request. Note that the un-parameterized form
 * doesn't tie `args` to `method` — build requests through a `<M>`-generic helper to keep them
 * correlated.
 */
export interface CallRequest<M extends keyof ReplayDbCalls = keyof ReplayDbCalls> {
  type: 'call'
  id: number
  method: M
  args: Parameters<ReplayDbCalls[M]>
}

export type ToWorkerMessage = CallRequest

// --- Worker -> main thread ---

/** Posted once the DB is open and the watcher has started; purely informational for logging. */
export interface ReadyMessage {
  type: 'ready'
}

export type CallResultMessage = {
  type: 'callResult'
  id: number
} & ({ result: unknown } | { error: Error })

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
  | CallResultMessage
  | BackfillProgressMessage
  | ChangedMessage
  | LogMessage
