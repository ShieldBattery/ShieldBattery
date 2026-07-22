import isDev from 'electron-is-dev'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import createDeferred, { Deferred } from '../../common/async/deferred'
import { getErrorStack } from '../../common/errors'
import { TypedIpcMain, TypedIpcSender } from '../../common/ipc'
import { ReplayLibraryStatus } from '../../common/replays-library'
import log from '../logger'
import {
  FromWorkerMessage,
  ReplayDbWorkerData,
  ReplayQueryResult,
  ToWorkerMessage,
} from './worker/messages'

/**
 * How many times in a row the worker may crash-and-restart before we give up. A persistent failure
 * (e.g. a corrupt DB file or a native module that won't load) would otherwise busy-loop; a healthy
 * worker resets this the moment it reports `ready`.
 */
const MAX_CONSECUTIVE_RESTARTS = 5

export interface ReplayLibraryOptions {
  /** Absolute path to the SQLite index file. */
  dbPath: string
  /** Absolute path to the replay folder to index (watched recursively). */
  watchedFolder: string
  /** Returns the sender for the current renderer window, so change events reach it even after the
   * window is recreated. */
  getSender: () => TypedIpcSender
}

/**
 * Owns the local replay index. The actual SQLite DB, folder watcher, and replay parsing all live in
 * a worker thread (`./worker/db-worker`) so their synchronous file I/O never blocks Electron's main
 * thread; this class is the main-thread half — it spawns/supervises the worker, exposes the index to
 * the renderer over IPC by forwarding requests to the worker, and relays the worker's index-change
 * events (and log lines) back out.
 */
export class ReplayLibraryService {
  private worker: Worker | undefined
  private nextRequestId = 0
  private consecutiveRestarts = 0
  private readonly pending = new Map<number, Deferred<any>>()

  constructor(private readonly options: ReplayLibraryOptions) {
    const ipcMain = new TypedIpcMain()
    ipcMain.handle('replayLibraryQuery', async (_event, filters) =>
      this.request<ReplayQueryResult>(id => ({ type: 'query', id, filters })),
    )
    ipcMain.handle('replayLibraryStatus', async () =>
      this.request<ReplayLibraryStatus>(id => ({ type: 'status', id })),
    )

    this.startWorker()
  }

  private startWorker(): void {
    const workerData: ReplayDbWorkerData = {
      // Dev loads the worker from TypeScript source through a babel-register launcher; production
      // loads the prebuilt bundle directly (see `webpack.config.js`), so `entry` is unused there.
      entry: isDev ? path.join(__dirname, 'worker', 'db-worker.ts') : undefined,
      dbPath: this.options.dbPath,
      watchedFolder: this.options.watchedFolder,
    }
    const worker = isDev
      ? new Worker(path.join(__dirname, 'worker', 'launch.js'), {
          workerData,
          name: 'replay-db-worker',
        })
      : new Worker(path.join(__dirname, 'db-worker.js'), {
          workerData,
          name: 'replay-db-worker',
        })

    worker
      .on('message', (message: FromWorkerMessage) => this.onWorkerMessage(message))
      .on('error', err => {
        // `exit` fires after this, which handles the restart.
        log.error(`Replay DB worker error: ${getErrorStack(err)}`)
      })
      .on('exit', code => {
        this.worker = undefined
        this.rejectAllPending(new Error('replay DB worker exited before responding'))

        this.consecutiveRestarts += 1
        if (this.consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
          log.error(
            `Replay DB worker exited with code ${code} and has failed ` +
              `${this.consecutiveRestarts} times in a row; giving up on the replay index`,
          )
          return
        }

        log.error(`Replay DB worker exited with code ${code}; restarting`)
        this.startWorker()
      })

    this.worker = worker
  }

  private request<T>(build: (id: number) => ToWorkerMessage): Promise<T> {
    if (!this.worker) {
      return Promise.reject(new Error('replay DB worker is not running'))
    }

    const id = this.nextRequestId++
    const deferred = createDeferred<T>()
    this.pending.set(id, deferred)
    this.worker.postMessage(build(id))
    return deferred
  }

  private onWorkerMessage(message: FromWorkerMessage): void {
    switch (message.type) {
      case 'ready':
        this.consecutiveRestarts = 0
        log.verbose('Replay DB worker ready')
        break
      case 'queryResult':
      case 'statusResult': {
        const deferred = this.pending.get(message.id)
        if (!deferred) {
          log.warning(`Received a ${message.type} for unknown replay request ${message.id}`)
          break
        }
        this.pending.delete(message.id)
        if ('error' in message) {
          deferred.reject(message.error)
        } else {
          deferred.resolve(message.type === 'queryResult' ? message.result : message.status)
        }
        break
      }
      case 'backfillProgress':
        this.options.getSender().send('replayLibraryBackfillProgress', message.progress)
        break
      case 'changed':
        this.options.getSender().send('replayLibraryChanged')
        break
      case 'log':
        log[message.level](message.message)
        break
      default:
        message satisfies never
    }
  }

  private rejectAllPending(err: Error): void {
    for (const deferred of this.pending.values()) {
      deferred.reject(err)
    }
    this.pending.clear()
  }
}

/** Creates the replay library service, registering its IPC handlers and starting the index worker. */
export function setupReplayLibrary(options: ReplayLibraryOptions): ReplayLibraryService {
  return new ReplayLibraryService(options)
}
