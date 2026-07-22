import { rmSync } from 'node:fs'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { ReplayLibraryStatus } from '../../../common/replays-library'
import { ReplayDb } from '../replay-db'
import { ReplayLibraryLogger, ReplayWatcher } from '../replay-watcher'
import { FromWorkerMessage, ReplayDbCalls, ReplayDbWorkerData, ToWorkerMessage } from './messages'

// Owns the SQLite index and the folder watcher, off the main thread. All the synchronous
// better-sqlite3 work (queries plus the per-file writes a backfill does) and the WASM replay
// parsing happen here, so they never block Electron's main thread. The main thread talks to this
// worker purely through the message protocol in `./messages`.

if (isMainThread) {
  throw new Error('db-worker should not be run in the main thread')
}

const { dbPath, watchedFolder } = workerData as ReplayDbWorkerData

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
const watcher = new ReplayWatcher(watchedFolder, db, logger, {
  onProgress: progress => post({ type: 'backfillProgress', progress }),
  onChange: () => post({ type: 'changed' }),
})

function getStatus(): ReplayLibraryStatus {
  return {
    totalIndexed: db.getTotalIndexed(),
    bookmarkedCount: db.getBookmarkedCount(),
    backfill: watcher.getBackfillProgress(),
    watchedFolder,
  }
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
}

parentPort!.on('message', (message: ToWorkerMessage) => {
  try {
    // `message.method`/`message.args` aren't correlated after transfer (see `CallRequest`), so
    // the invocation goes through an untyped signature; `calls` itself is fully typed.
    const method = calls[message.method] as (...args: unknown[]) => unknown
    post({ type: 'callResult', id: message.id, result: method(...message.args) })
  } catch (error) {
    post({ type: 'callResult', id: message.id, error: error as Error })
  }
})

watcher.start()
post({ type: 'ready' })
