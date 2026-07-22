import isDev from 'electron-is-dev'
import path from 'node:path'
import { Worker } from 'node:worker_threads'
import createDeferred, { Deferred } from '../../common/async/deferred'
import { getErrorStack } from '../../common/errors'
import { TypedIpcMain, TypedIpcSender } from '../../common/ipc'
import log from '../logger'
import { saveReplayToLibrary } from './replay-save'
import {
  CallRequest,
  FromWorkerMessage,
  ReplayDbCalls,
  ReplayDbWorkerData,
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
  /** Absolute paths of the replay folders to index (each watched recursively). */
  watchedFolders: ReadonlyArray<string>
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
  /**
   * The folders currently being indexed. Kept as service state (rather than reading `options` each
   * time) so a crashed worker respawns with the latest set, not the one it was first created with.
   */
  private watchedFolders: ReadonlyArray<string>

  constructor(private readonly options: ReplayLibraryOptions) {
    this.watchedFolders = options.watchedFolders

    const ipcMain = new TypedIpcMain()
    ipcMain.handle('replayLibraryQuery', async (_event, filters) => this.call('query', filters))
    ipcMain.handle('replayLibraryStatus', async () => this.call('status'))

    ipcMain.handle('replayLibrarySetBookmarked', async (_event, replayId, bookmarked) => {
      await this.call('setBookmarked', replayId, bookmarked)
      this.notifyChanged()
    })
    ipcMain.handle('replayLibraryListPlaylists', async () => this.call('listPlaylists'))
    ipcMain.handle('replayLibraryCreatePlaylist', async (_event, name) => {
      const id = await this.call('createPlaylist', name)
      this.notifyChanged()
      return id
    })
    ipcMain.handle('replayLibraryRenamePlaylist', async (_event, id, name) => {
      await this.call('renamePlaylist', id, name)
      this.notifyChanged()
    })
    ipcMain.handle('replayLibraryDeletePlaylist', async (_event, id) => {
      await this.call('deletePlaylist', id)
      this.notifyChanged()
    })
    ipcMain.handle('replayLibraryAddToPlaylist', async (_event, playlistId, replayIds) => {
      await this.call('addToPlaylist', playlistId, replayIds)
      this.notifyChanged()
    })
    ipcMain.handle('replayLibraryRemoveFromPlaylist', async (_event, playlistId, replayIds) => {
      await this.call('removeFromPlaylist', playlistId, replayIds)
      this.notifyChanged()
    })
    ipcMain.handle(
      'replayLibraryMovePlaylistEntry',
      async (_event, playlistId, replayId, toIndex) => {
        await this.call('movePlaylistEntry', playlistId, replayId, toIndex)
        this.notifyChanged()
      },
    )
    ipcMain.handle('replayLibraryGetPlaylistsForReplay', async (_event, replayId) =>
      this.call('getPlaylistsForReplay', replayId),
    )
    ipcMain.handle('replayLibraryFindByGameId', async (_event, gameId) =>
      this.call('findReplayIdByGameId', gameId),
    )
    ipcMain.handle(
      'replayLibrarySaveReplay',
      async (_event, gameId, filename, expectedHash, data) =>
        // Saved replays go into the first configured folder; the watcher then indexes them from
        // there. The list is always non-empty (it resolves to the default folder when unset).
        saveReplayToLibrary(this.watchedFolders[0], gameId, filename, expectedHash, data),
    )

    this.startWorker()
  }

  /**
   * Swaps the folders being indexed: updates the stored set (so a worker respawn uses it) and
   * forwards it to the running worker's watcher. Also notifies the renderer, since the folder set is
   * surfaced in the library status and a folder change may not itself produce a reconcile event.
   */
  setWatchedFolders(folders: ReadonlyArray<string>): void {
    this.watchedFolders = folders
    this.call('setWatchedFolders', [...folders]).catch(err => {
      log.error(`Error updating replay library folders: ${getErrorStack(err)}`)
    })
    this.notifyChanged()
  }

  /** Notifies the renderer that the index changed, for mutations outside the watcher's own path. */
  private notifyChanged(): void {
    this.options.getSender().send('replayLibraryChanged')
  }

  private startWorker(): void {
    const workerData: ReplayDbWorkerData = {
      // Dev loads the worker from TypeScript source through a babel-register launcher; production
      // loads the prebuilt bundle directly (see `webpack.config.js`), so `entry` is unused there.
      entry: isDev ? path.join(__dirname, 'worker', 'db-worker.ts') : undefined,
      dbPath: this.options.dbPath,
      watchedFolders: [...this.watchedFolders],
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

  /** Invokes one of the worker's `ReplayDbCalls` operations as a correlated request/response. */
  private call<M extends keyof ReplayDbCalls>(
    method: M,
    ...args: Parameters<ReplayDbCalls[M]>
  ): Promise<ReturnType<ReplayDbCalls[M]>> {
    if (!this.worker) {
      return Promise.reject(new Error('replay DB worker is not running'))
    }

    const id = this.nextRequestId++
    const deferred = createDeferred<ReturnType<ReplayDbCalls[M]>>()
    this.pending.set(id, deferred)
    const message: CallRequest<M> = { type: 'call', id, method, args }
    this.worker.postMessage(message)
    return deferred
  }

  private onWorkerMessage(message: FromWorkerMessage): void {
    switch (message.type) {
      case 'ready':
        this.consecutiveRestarts = 0
        log.verbose('Replay DB worker ready')
        break
      case 'callResult': {
        const deferred = this.pending.get(message.id)
        if (!deferred) {
          log.warning(`Received a result for unknown replay request ${message.id}`)
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
