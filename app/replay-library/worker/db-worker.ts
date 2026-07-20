import { isMainThread, parentPort, workerData } from 'node:worker_threads'
import { ReplayLibraryStatus } from '../../../common/replays-library'
import { ReplayDb } from '../replay-db'
import { ReplayLibraryLogger, ReplayWatcher } from '../replay-watcher'
import { FromWorkerMessage, ReplayDbWorkerData, ToWorkerMessage } from './messages'

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

const db = new ReplayDb(dbPath)
const watcher = new ReplayWatcher(watchedFolder, db, logger, {
  onProgress: progress => post({ type: 'backfillProgress', progress }),
  onChange: () => post({ type: 'changed' }),
})

function getStatus(): ReplayLibraryStatus {
  return {
    totalIndexed: db.getTotalIndexed(),
    backfill: watcher.getBackfillProgress(),
    watchedFolder,
  }
}

parentPort!.on('message', (message: ToWorkerMessage) => {
  if (message.type === 'query') {
    try {
      post({ type: 'queryResult', id: message.id, result: db.query(message.filters) })
    } catch (error) {
      post({ type: 'queryResult', id: message.id, error: error as Error })
    }
  } else if (message.type === 'status') {
    try {
      post({ type: 'statusResult', id: message.id, status: getStatus() })
    } catch (error) {
      post({ type: 'statusResult', id: message.id, error: error as Error })
    }
  } else {
    message satisfies never
  }
})

watcher.start()
post({ type: 'ready' })
