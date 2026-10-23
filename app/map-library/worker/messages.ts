import {
  LocalMapFolder,
  LocalMapIndexProgress,
  LocalMapInfo,
  LocalMapLibraryStatus,
  LocalMapQuery,
  LocalMapQueryResult,
} from '../../../common/map-library'
import { MapRootFolder } from '../map-folders'

/** The data handed to the map index worker at construction time (via `workerData`). */
export interface MapIndexWorkerData {
  /** Absolute path to the SQLite index file. */
  dbPath: string
  roots: MapRootFolder[]
}

/**
 * The operations the main thread can invoke on the worker. The worker runs the method and answers
 * with a `CallResultMessage`; adding an operation here means implementing it in the worker's
 * `calls` table.
 */
export interface MapIndexCalls {
  query: (query: LocalMapQuery) => LocalMapQueryResult
  folders: (parent?: string) => LocalMapFolder[]
  status: () => LocalMapLibraryStatus
  /** The path of an indexed, readable map file with this hash, for rendering its image. */
  findPathByHash: (hash: string) => string | undefined
  /** Replaces the indexed folders. Rides the call channel so it stays ordered with queries. */
  setRoots: (roots: MapRootFolder[]) => void
}

// --- Main thread -> worker ---

/** A request to run one of `MapIndexCalls` in the worker, correlated by `id`. */
export interface CallRequest<M extends keyof MapIndexCalls = keyof MapIndexCalls> {
  type: 'call'
  id: number
  method: M
  args: Parameters<MapIndexCalls[M]>
}

export type ToWorkerMessage = CallRequest

// --- Worker -> main thread ---

/** Posted once the index is open and the watcher has started. */
export interface ReadyMessage {
  type: 'ready'
}

export type CallResultMessage = {
  type: 'callResult'
  id: number
} & ({ result: unknown } | { error: Error })

/** Mirrors `MapWatcher`'s `onProgress`, forwarded to the renderer as `localMapsIndexProgress`. */
export interface ProgressMessage {
  type: 'progress'
  progress: LocalMapIndexProgress | undefined
}

/** Mirrors `MapWatcher`'s `onChange`, forwarded to the renderer as `localMapsChanged`. */
export interface ChangedMessage {
  type: 'changed'
}

/** A log line from the worker, written to the app log by the main thread. */
export interface LogMessage {
  type: 'log'
  level: 'error' | 'warning' | 'verbose'
  message: string
}

// --- Index worker <-> map reader worker ---

/** Asks a map reader to read and hash a file, or to read the facts of the file it last hashed. */
export type ReaderRequest =
  | { type: 'hash'; id: number; path: string; size: number }
  | { type: 'summarize'; id: number }

export type ReaderResponse = { id: number } & (
  | { hash: string }
  | { map: LocalMapInfo }
  | { error: string }
)

// --- Main thread <-> map renderer worker ---

/** The data handed to a map renderer worker at construction time (via `workerData`). */
export interface MapRendererWorkerData {
  /** The StarCraft install directory (the one containing `.build.info`) to read assets from. */
  installPath: string
}

/** Asks a map renderer to render the file at `path`, which must still hash to `hash`. */
export interface RenderRequest {
  id: number
  path: string
  hash: string
  /** The longest side of the image, in pixels. */
  size: number
}

export type RenderResponse = { id: number } & (
  | {
      width: number
      height: number
      /** The image's pixels, 4 bytes each in BGRA order (what `nativeImage` takes). */
      bgra: Uint8Array
      /** The size of the map file, so the renderer can be replaced after very large ones. */
      fileSize: number
    }
  | { error: string }
)

export type FromWorkerMessage =
  | ReadyMessage
  | CallResultMessage
  | ProgressMessage
  | ChangedMessage
  | LogMessage
