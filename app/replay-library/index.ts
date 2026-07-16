import { TypedIpcMain, TypedIpcSender } from '../../common/ipc'
import { ReplayLibraryStatus } from '../../common/replays-library'
import { ReplayDb } from './replay-db'
import { ReplayWatcher } from './replay-watcher'

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
 * Owns the local replay index: the SQLite DB, the folder watcher/backfill, and the IPC surface the
 * renderer uses to query it.
 */
export class ReplayLibraryService {
  private readonly db: ReplayDb
  private readonly watcher: ReplayWatcher

  constructor(private readonly options: ReplayLibraryOptions) {
    this.db = new ReplayDb(options.dbPath)
    this.watcher = new ReplayWatcher(options.watchedFolder, this.db, {
      onProgress: progress => options.getSender().send('replayLibraryBackfillProgress', progress),
      onChange: () => options.getSender().send('replayLibraryChanged'),
    })

    const ipcMain = new TypedIpcMain()
    ipcMain.handle('replayLibraryQuery', async (_event, filters) => this.db.query(filters))
    ipcMain.handle('replayLibraryGetMaps', async () => this.db.getDistinctMapNames())
    ipcMain.handle('replayLibraryStatus', async () => this.getStatus())
  }

  start(): void {
    this.watcher.start()
  }

  private getStatus(): ReplayLibraryStatus {
    return {
      totalIndexed: this.db.getTotalIndexed(),
      backfill: this.watcher.getBackfillProgress(),
      watchedFolder: this.options.watchedFolder,
    }
  }
}

/** Creates the replay library service, registers its IPC handlers, and starts indexing. */
export function setupReplayLibrary(options: ReplayLibraryOptions): ReplayLibraryService {
  const service = new ReplayLibraryService(options)
  service.start()
  return service
}
