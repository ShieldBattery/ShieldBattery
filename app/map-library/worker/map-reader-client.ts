import path from 'node:path'
import { Worker } from 'node:worker_threads'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { getErrorStack } from '../../../common/errors'
import { LocalMapInfo } from '../../../common/map-library'
import { MapFileReader } from '../map-watcher'
import { ReaderRequest, ReaderResponse } from './messages'

/**
 * Reading a map file grows broodmap's WebAssembly memory to a few times the file's size, and it
 * never shrinks. After reading a file larger than this, the reader's worker is replaced, so one
 * huge map doesn't keep the memory it took for the rest of the indexing pass.
 */
const RESTART_AFTER_FILE_BYTES = 16 * 1024 * 1024
/**
 * How long reading one map's facts may take before the reader is ended and the file is taken for
 * unreadable. The largest real maps take a few seconds; a file that makes broodmap loop forever
 * would otherwise hold its slot, and with it the indexing pass, for good.
 */
const SUMMARIZE_TIMEOUT_MS = 60 * 1000

/**
 * A `MapFileReader` backed by a `map-reader` worker. The worker starts on first use and is replaced
 * after reading a very large map, and after any failure to read one (broodmap's WebAssembly state
 * can't be trusted after one).
 */
export class WorkerMapFileReader implements MapFileReader {
  private worker: Worker | undefined
  private nextId = 0
  /** Requests awaiting a response, with the worker each was sent to. */
  private readonly pending = new Map<
    number,
    { deferred: Deferred<ReaderResponse>; worker: Worker }
  >()
  private lastFileSize = 0

  hash(filePath: string, size: number): Promise<string> {
    this.lastFileSize = size
    return this.request({ type: 'hash', id: this.nextId++, path: filePath, size }).then(
      response => {
        if ('hash' in response) {
          return response.hash
        }
        throw new Error('error' in response ? response.error : 'unexpected reader response')
      },
    )
  }

  summarize(): Promise<LocalMapInfo> {
    const request = this.request({ type: 'summarize', id: this.nextId++ }, SUMMARIZE_TIMEOUT_MS)
    return request.then(response => {
      if ('map' in response) {
        if (this.lastFileSize > RESTART_AFTER_FILE_BYTES) {
          this.close().catch(() => {})
        }
        return response.map
      }
      // A failed read may have left the WebAssembly instance in a bad state; the next file gets a
      // fresh one. Hashing the next file reads it again, so nothing is lost.
      this.close().catch(() => {})
      throw new Error('error' in response ? response.error : 'unexpected reader response')
    })
  }

  async close(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    if (worker) {
      await worker.terminate()
    }
  }

  private request(request: ReaderRequest, timeoutMs?: number): Promise<ReaderResponse> {
    const worker = this.ensureWorker()
    const deferred = createDeferred<ReaderResponse>()
    this.pending.set(request.id, { deferred, worker })
    worker.postMessage(request)
    if (timeoutMs === undefined) {
      return deferred
    }

    const timer = setTimeout(() => {
      if (this.pending.get(request.id)?.deferred === deferred) {
        this.pending.delete(request.id)
        deferred.reject(new Error(`map reader didn't respond within ${timeoutMs}ms`))
        if (this.worker === worker) {
          this.close().catch(() => {})
        }
      }
    }, timeoutMs)
    return deferred.finally(() => clearTimeout(timer))
  }

  private ensureWorker(): Worker {
    if (this.worker) {
      return this.worker
    }
    // Its own entry in the same build output as the index worker that loads this module.
    const worker = new Worker(path.join(__dirname, 'map-reader.js'), { name: 'map-reader' })
    let fatalError: unknown
    worker
      .on('message', (response: ReaderResponse) => {
        const request = this.pending.get(response.id)
        this.pending.delete(response.id)
        request?.deferred.resolve(response)
      })
      .on('error', err => {
        // An unhandled `error` event would throw in this thread and take the index worker down
        // with the reader (e.g. on an out-of-memory read). `exit` fires after this and fails the
        // reader's pending requests, so the file is taken for unreadable instead.
        fatalError = err
      })
      .on('exit', () => {
        if (this.worker === worker) {
          this.worker = undefined
        }
        const error = new Error(
          'map reader exited before responding' +
            (fatalError ? `: ${getErrorStack(fatalError) ?? String(fatalError)}` : ''),
        )
        // Only this worker's requests: a replacement may already be serving newer ones
        for (const [id, request] of this.pending) {
          if (request.worker === worker) {
            this.pending.delete(id)
            request.deferred.reject(error)
          }
        }
      })
    this.worker = worker
    return worker
  }
}
