import {
  ReplayBackfillProgress,
  ReplayLibraryEntry,
  ReplayLibraryFilters,
  ReplayLibraryStatus,
  ReplayPlaylist,
} from '../../../common/replays-library'

/** The data handed to the replay DB worker at construction time (via `workerData`). */
export interface ReplayDbWorkerData {
  /** Absolute path to the SQLite index file. */
  dbPath: string
  /** Absolute paths of the replay folders to index (each watched recursively). */
  watchedFolders: string[]
}

/** A page of query results, matching `ReplayDb.query`'s return shape. */
export interface ReplayQueryResult {
  entries: ReplayLibraryEntry[]
  total: number
}

/**
 * The operations the main thread can invoke on the worker, each mirroring a method of the
 * worker-side DB (or, for `indexFile`, a parse-and-index step built from the same pieces the
 * watcher uses). Most are synchronous; `indexFile` does file I/O and returns a `Promise`, which the
 * worker's dispatch loop awaits before answering. The worker runs the method and answers with a
 * `CallResultMessage`; adding an operation here means implementing it in the worker's `calls`
 * table.
 */
export interface ReplayDbCalls {
  query: (filters: ReplayLibraryFilters) => ReplayQueryResult
  status: () => ReplayLibraryStatus
  /** Returns whether the bookmark state actually changed (false if already in that state). */
  setBookmarked: (replayId: number, bookmarked: boolean) => boolean
  listPlaylists: () => ReplayPlaylist[]
  createPlaylist: (name: string) => number
  renamePlaylist: (playlistId: number, name: string) => void
  deletePlaylist: (playlistId: number) => void
  /** Returns the ids actually added (ones not already in the playlist). */
  addToPlaylist: (playlistId: number, replayIds: number[]) => number[]
  removeFromPlaylist: (playlistId: number, replayIds: number[]) => void
  movePlaylistEntry: (playlistId: number, replayId: number, toIndex: number) => void
  getPlaylistsForReplay: (replayId: number) => Array<{ id: number; name: string }>
  findReplayIdByGameId: (gameId: string) => number | undefined
  /**
   * Parses and (re)indexes a single file immediately, then resolves with its index id (`undefined`
   * only if the write itself fails to produce a row, which shouldn't normally happen). Used by the
   * "Save replay" IPC to resolve the id of a just-saved file synchronously with the request, rather
   * than polling for the watcher's own (debounced, asynchronous) reconcile to catch up.
   */
  indexFile: (path: string) => Promise<number | undefined>
  /**
   * Replaces the set of watched folders. This is watcher control rather than a DB read/write, but it
   * rides the same call channel so it stays ordered with the queries the worker serves.
   */
  setWatchedFolders: (folders: string[]) => void
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

/**
 * Mirrors `ReplayWatcher`'s `onProgress`, forwarded to the renderer as
 * `replayLibraryBackfillProgress`. An `undefined` progress means the backfill finished (or had no
 * work).
 */
export interface BackfillProgressMessage {
  type: 'backfillProgress'
  progress: ReplayBackfillProgress | undefined
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
  ReadyMessage | CallResultMessage | BackfillProgressMessage | ChangedMessage | LogMessage
