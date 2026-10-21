import { rmSync } from 'node:fs'
import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { getErrorStack } from '../../../common/errors'
import { MapDb } from '../map-db'
import { childFolders } from '../map-folders'
import { MapLibraryLogger, MapWatcher } from '../map-watcher'
import { WorkerMapFileReader } from './map-reader-client'
import { FromWorkerMessage, MapIndexCalls, MapIndexWorkerData, ToWorkerMessage } from './messages'

// Owns the local map index and the folder watcher, off the main thread: hashing and reading map
// files and the synchronous better-sqlite3 work happen here, so they never block Electron's main
// thread. The main thread talks to this worker purely through the protocol in `./messages`.

if (isMainThread) {
  throw new Error('map-worker should not be run in the main thread')
}

const { dbPath, roots } = workerData as MapIndexWorkerData

function post(message: FromWorkerMessage): void {
  parentPort!.postMessage(message)
}

const logger: MapLibraryLogger = {
  error: message => post({ type: 'log', level: 'error', message }),
  warning: message => post({ type: 'log', level: 'warning', message }),
  verbose: message => post({ type: 'log', level: 'verbose', message }),
}

/**
 * Opens the map index, rebuilding it from scratch if the file can't be opened. The index is a pure
 * cache of the map folders, so an unreadable file is discarded rather than crash-looping the worker.
 */
function openMapDb(path: string): MapDb {
  try {
    return new MapDb(path)
  } catch (err) {
    // Busy or locked means another app instance holds the file, not that it's corrupt; the worker
    // supervisor's restarts serve as the retry.
    const code = (err as { code?: string }).code
    if (code?.startsWith('SQLITE_BUSY') || code?.startsWith('SQLITE_LOCKED')) {
      throw err
    }

    logger.warning(`Recreating unreadable map index at ${path}: ${getErrorStack(err)}`)
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        rmSync(path + suffix, { force: true })
      } catch {
        // Best-effort; if a file genuinely can't be removed, the retry below surfaces it.
      }
    }
    return new MapDb(path)
  }
}

const db = openMapDb(dbPath)
const watcher = new MapWatcher(
  roots,
  db,
  logger,
  {
    onProgress: progress => post({ type: 'progress', progress }),
    onChange: () => post({ type: 'changed' }),
  },
  () => new WorkerMapFileReader(),
)

const calls: MapIndexCalls = {
  query: query => db.query(query),
  folders: parent => childFolders(db.getFolderCounts(), parent),
  status: () => ({
    totalIndexed: db.getTotalIndexed(),
    progress: watcher.getProgress(),
    roots: watcher.getRoots(),
  }),
  setRoots: nextRoots => watcher.setRoots(nextRoots),
}

parentPort!.on('message', (message: ToWorkerMessage) => {
  const method = calls[message.method] as (...args: unknown[]) => unknown
  Promise.resolve()
    .then(() => method(...message.args))
    .then(result => post({ type: 'callResult', id: message.id, result }))
    .catch(error => post({ type: 'callResult', id: message.id, error: error as Error }))
})

watcher.start()
post({ type: 'ready' })
