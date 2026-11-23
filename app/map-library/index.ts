import path from 'node:path'
import { Worker } from 'node:worker_threads'
import createDeferred, { Deferred } from '../../common/async/deferred'
import { getErrorStack } from '../../common/errors'
import { TypedIpcMain, TypedIpcSender } from '../../common/ipc'
import log from '../logger'
import { MapRootFolder } from './map-folders'
import {
  CallRequest,
  FromWorkerMessage,
  MapIndexCalls,
  MapIndexWorkerData,
} from './worker/messages'

/** How many times in a row the worker may crash and restart before the index is given up on. */
const MAX_CONSECUTIVE_RESTARTS = 5

export interface LocalMapLibraryOptions {
  /** Absolute path to the SQLite index file. */
  dbPath: string
  roots: ReadonlyArray<MapRootFolder>
  /** Returns the sender for the current renderer window, so events reach a recreated window. */
  getSender: () => TypedIpcSender
}

/**
 * Owns the index of the map files in the user's map folders. The index, the folder watcher and the
 * reading of map files live in a worker thread (`./worker/map-worker`); this is the main-thread
 * half, which supervises the worker, serves the renderer's requests by forwarding them to it, and
 * relays its change events and log lines.
 */
export class LocalMapLibraryService {
  private worker: Worker | undefined
  private nextRequestId = 0
  private consecutiveRestarts = 0
  private readonly pending = new Map<number, Deferred<any>>()
  /** Kept here so a restarted worker indexes the latest folders, not the ones it started with. */
  private roots: ReadonlyArray<MapRootFolder>

  constructor(private readonly options: LocalMapLibraryOptions) {
    this.roots = options.roots

    const ipcMain = new TypedIpcMain()
    ipcMain.handle('localMapsQuery', async (_event, query) => this.call('query', query))
    ipcMain.handle('localMapsFolders', async (_event, parent) => this.call('folders', parent))
    ipcMain.handle('localMapsStatus', async () => this.call('status'))

    this.startWorker()
  }

  /** The path of an indexed, readable map file with this hash. */
  findPathByHash(hash: string): Promise<string | undefined> {
    return this.call('findPathByHash', hash)
  }

  /** Swaps the indexed folders. */
  setRoots(roots: ReadonlyArray<MapRootFolder>): void {
    this.roots = roots
    this.call('setRoots', [...roots]).catch(err => {
      log.error(`Error updating the map folders: ${getErrorStack(err)}`)
    })
    this.options.getSender().send('localMapsChanged')
  }

  private startWorker(): void {
    const workerData: MapIndexWorkerData = {
      dbPath: this.options.dbPath,
      roots: [...this.roots],
    }
    // Its own entry in the same build output as this module, so the path holds wherever the app
    // runs from.
    const worker = new Worker(path.join(__dirname, 'map-worker.js'), {
      workerData,
      name: 'map-index-worker',
    })

    worker
      .on('message', (message: FromWorkerMessage) => this.onWorkerMessage(message))
      .on('error', err => {
        // `exit` fires after this, which handles the restart.
        log.error(`Map index worker error: ${getErrorStack(err)}`)
      })
      .on('exit', code => {
        this.worker = undefined
        this.rejectAllPending(new Error('map index worker exited before responding'))

        this.consecutiveRestarts += 1
        if (this.consecutiveRestarts > MAX_CONSECUTIVE_RESTARTS) {
          log.error(
            `Map index worker exited with code ${code} and has failed ` +
              `${this.consecutiveRestarts} times in a row; giving up on the map index`,
          )
          return
        }

        log.error(`Map index worker exited with code ${code}; restarting`)
        this.startWorker()
      })

    this.worker = worker
  }

  private call<M extends keyof MapIndexCalls>(
    method: M,
    ...args: Parameters<MapIndexCalls[M]>
  ): Promise<Awaited<ReturnType<MapIndexCalls[M]>>> {
    if (!this.worker) {
      return Promise.reject(new Error('map index worker is not running'))
    }

    const id = this.nextRequestId++
    const deferred = createDeferred<Awaited<ReturnType<MapIndexCalls[M]>>>()
    this.pending.set(id, deferred)
    const message: CallRequest<M> = { type: 'call', id, method, args }
    this.worker.postMessage(message)
    return deferred
  }

  private onWorkerMessage(message: FromWorkerMessage): void {
    switch (message.type) {
      case 'ready':
        this.consecutiveRestarts = 0
        log.verbose('Map index worker ready')
        break
      case 'callResult': {
        const deferred = this.pending.get(message.id)
        if (!deferred) {
          log.warning(`Received a result for unknown map index request ${message.id}`)
          break
        }
        this.pending.delete(message.id)
        if ('error' in message) {
          deferred.reject(message.error)
        } else {
          deferred.resolve(message.result)
        }
        break
      }
      case 'progress':
        this.options.getSender().send('localMapsIndexProgress', message.progress)
        break
      case 'changed':
        this.options.getSender().send('localMapsChanged')
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

/** Creates the local map library service, registering its IPC handlers and starting its worker. */
export function setupLocalMapLibrary(options: LocalMapLibraryOptions): LocalMapLibraryService {
  return new LocalMapLibraryService(options)
}
