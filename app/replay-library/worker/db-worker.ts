import { rmSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { ReplayLibraryStatus } from '../../../common/replays-library'
import { ReplayDb } from '../replay-db'
import {
  computeContentHash,
  makeParseErrorRecord,
  parseReplayFile,
  ReplayFileInfo,
} from '../replay-parser'
import { ReplayLibraryLogger, ReplayWatcher } from '../replay-watcher'
import { FromWorkerMessage, ReplayDbCalls, ReplayDbWorkerData, ToWorkerMessage } from './messages'

// Owns the SQLite index and the folder watcher, off the main thread. All the synchronous
// better-sqlite3 work (queries plus the per-file writes a backfill does) and the WASM replay
// parsing happen here, so they never block Electron's main thread. The main thread talks to this
// worker purely through the message protocol in `./messages`.

if (isMainThread) {
  throw new Error('db-worker should not be run in the main thread')
}

const { dbPath, watchedFolders } = workerData as ReplayDbWorkerData

function post(message: FromWorkerMessage): void {
  parentPort!.postMessage(message)
}

const logger: ReplayLibraryLogger = {
  error: message => post({ type: 'log', level: 'error', message }),
  warning: message => post({ type: 'log', level: 'warning', message }),
  verbose: message => post({ type: 'log', level: 'verbose', message }),
}

/**
 * Opens the replay index, rebuilding it from scratch if the existing file can't be opened or
 * migrated. The index is a pure cache of the on-disk replay folder, so a corrupt/unreadable file
 * (power loss mid-write, a schema written by an incompatible build, ...) is discarded and
 * re-created rather than crash-looping the worker forever against the same bad file. A second
 * failure is a real problem (e.g. the directory isn't writable) and is left to propagate.
 */
function openReplayDb(path: string): ReplayDb {
  try {
    return new ReplayDb(path)
  } catch (err) {
    // A busy/locked error means another process (e.g. a second app instance) is holding the file,
    // not that it's corrupt — deleting it would destroy a healthy shared index. Let the error
    // propagate; the worker supervisor's restarts serve as the retry.
    const code = (err as { code?: string }).code
    if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED')) {
      throw err
    }

    logger.warning(`Recreating unreadable replay index at ${path}: ${getErrorStack(err)}`)
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(path + suffix, { force: true })
      } catch {
        // Best-effort; if a file genuinely can't be removed, the retry below surfaces it.
      }
    }
    return new ReplayDb(path)
  }
}

const db = openReplayDb(dbPath)
const watcher = new ReplayWatcher(watchedFolders, db, logger, {
  onProgress: progress => post({ type: 'backfillProgress', progress }),
  onChange: () => post({ type: 'changed' }),
})

function getStatus(): ReplayLibraryStatus {
  return {
    totalIndexed: db.getTotalIndexed(),
    bookmarkedCount: db.getBookmarkedCount(),
    backfill: watcher.getBackfillProgress(),
    watchedFolders: watcher.getWatchedFolders(),
  }
}

/**
 * Parses and (re)indexes a single file right away, sharing the same parse-or-parse-error-record
 * shape the watcher's own `indexFile` step produces, then returns the file's index id. Unlike the
 * watcher's reconcile, this doesn't consult the existing index state first (no mtime/size
 * short-circuit) since it's only called for a file whose content is already known to be new or
 * freshly verified (a just-saved replay).
 */
async function indexFile(path: string): Promise<number | undefined> {
  const stats = await stat(path)
  const contentHash = await computeContentHash(path)
  const fileInfo: ReplayFileInfo = {
    path,
    fileMtime: Math.floor(stats.mtimeMs),
    fileSize: stats.size,
    contentHash,
  }

  const record = await parseReplayFile(fileInfo).catch(() => makeParseErrorRecord(fileInfo))
  db.upsertReplay(record)
  return db.getIdByPath(path)
}

/** Implementations of the operations the main thread can request (see `ReplayDbCalls`). */
const calls: ReplayDbCalls = {
  query: filters => db.query(filters),
  status: () => getStatus(),
  setBookmarked: (replayId, bookmarked) => db.setBookmarked(replayId, bookmarked),
  listPlaylists: () => db.listPlaylists(),
  createPlaylist: name => db.createPlaylist(name),
  renamePlaylist: (playlistId, name) => db.renamePlaylist(playlistId, name),
  deletePlaylist: playlistId => db.deletePlaylist(playlistId),
  addToPlaylist: (playlistId, replayIds) => db.addToPlaylist(playlistId, replayIds),
  removeFromPlaylist: (playlistId, replayIds) => db.removeFromPlaylist(playlistId, replayIds),
  movePlaylistEntry: (playlistId, replayId, toIndex) =>
    db.movePlaylistEntry(playlistId, replayId, toIndex),
  getPlaylistsForReplay: replayId => db.getPlaylistsForReplay(replayId),
  findReplayIdByGameId: gameId => db.findReplayIdByGameId(gameId),
  indexFile: path => indexFile(path),
  setWatchedFolders: folders => watcher.setWatchedFolders(folders),
}

parentPort!.on('message', (message: ToWorkerMessage) => {
  // `message.method`/`message.args` aren't correlated after transfer (see `CallRequest`), so the
  // invocation goes through an untyped signature; `calls` itself is fully typed. Wrapping the call
  // in `Promise.resolve()` lets a synchronous method's result and a `Promise`-returning one's
  // (e.g. `indexFile`) both flow through the same await-then-post path.
  const method = calls[message.method] as (...args: unknown[]) => unknown
  Promise.resolve()
    .then(() => method(...message.args))
    .then(result => post({ type: 'callResult', id: message.id, result }))
    .catch(error => post({ type: 'callResult', id: message.id, error: error as Error }))
})

watcher.start()
post({ type: 'ready' })
