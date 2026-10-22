import path from 'node:path'
import { Worker } from 'node:worker_threads'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { getErrorStack } from '../../../common/errors'
import { MapRendererWorkerData, RenderRequest, RenderResponse } from './messages'

/** A rendered map image, 4 bytes per pixel in BGRA order. */
export interface RenderedMapImage {
  width: number
  height: number
  bgra: Uint8Array
}

/** Renders images of local map files from a StarCraft install's assets. */
export interface MapImageRenderer {
  render(
    installPath: string,
    filePath: string,
    hash: string,
    size: number,
  ): Promise<RenderedMapImage>
}

/**
 * Rendering a map grows broodmap's WebAssembly memory to a few times the file's size, and it never
 * shrinks. After rendering a file larger than this, the renderer's worker is replaced.
 */
const RESTART_AFTER_FILE_BYTES = 16 * 1024 * 1024
/** How long a render may take before the renderer is ended and the render taken as failed. */
const RENDER_TIMEOUT_MS = 60 * 1000
/**
 * How long the renderer may sit idle before it's ended, giving back the memory its asset cache
 * holds. Scrolling through maps renders in bursts, which this comfortably spans.
 */
const IDLE_TIMEOUT_MS = 60 * 1000

interface RenderJob {
  installPath: string
  filePath: string
  hash: string
  size: number
  deferred: Deferred<RenderedMapImage>
}

/**
 * A `MapImageRenderer` backed by a `map-renderer` worker, rendering one map at a time. The most
 * recently requested map is rendered first, since that's the one most likely to be on screen. The
 * worker starts on first use, and is replaced after a failed render (broodmap's WebAssembly state
 * can't be trusted after one), after a very large map, when the install changes, and when idle.
 */
export class WorkerMapImageRenderer implements MapImageRenderer {
  private worker: { worker: Worker; installPath: string } | undefined
  private readonly queue: RenderJob[] = []
  private current: { id: number; job: RenderJob; worker: Worker; timer: NodeJS.Timeout } | undefined
  private nextId = 0
  private idleTimer: NodeJS.Timeout | undefined

  render(
    installPath: string,
    filePath: string,
    hash: string,
    size: number,
  ): Promise<RenderedMapImage> {
    const deferred = createDeferred<RenderedMapImage>()
    this.queue.push({ installPath, filePath, hash, size, deferred })
    this.pump()
    return deferred
  }

  private pump(): void {
    if (this.current) {
      return
    }
    const job = this.queue.pop()
    if (!job) {
      this.scheduleIdleStop()
      return
    }

    clearTimeout(this.idleTimer)
    const worker = this.ensureWorker(job.installPath)
    const id = this.nextId++
    const timer = setTimeout(() => {
      if (this.current?.id === id) {
        this.fail(new Error(`map renderer didn't respond within ${RENDER_TIMEOUT_MS}ms`))
      }
    }, RENDER_TIMEOUT_MS)
    this.current = { id, job, worker, timer }

    const request: RenderRequest = { id, path: job.filePath, hash: job.hash, size: job.size }
    worker.postMessage(request)
  }

  private onResponse(response: RenderResponse): void {
    const current = this.current
    if (!current || current.id !== response.id) {
      return
    }
    if ('error' in response) {
      this.fail(new Error(response.error))
      return
    }

    clearTimeout(current.timer)
    this.current = undefined
    current.job.deferred.resolve({
      width: response.width,
      height: response.height,
      bgra: response.bgra,
    })
    if (response.fileSize > RESTART_AFTER_FILE_BYTES) {
      this.stopWorker()
    }
    this.pump()
  }

  /** Fails the current render and replaces the worker, then moves on to the next render. */
  private fail(error: Error): void {
    const current = this.current
    if (current) {
      clearTimeout(current.timer)
      this.current = undefined
      current.job.deferred.reject(error)
    }
    this.stopWorker()
    this.pump()
  }

  private scheduleIdleStop(): void {
    clearTimeout(this.idleTimer)
    if (this.worker) {
      this.idleTimer = setTimeout(() => {
        if (!this.current && !this.queue.length) {
          this.stopWorker()
        }
      }, IDLE_TIMEOUT_MS)
    }
  }

  private stopWorker(): void {
    const worker = this.worker?.worker
    this.worker = undefined
    worker?.terminate().catch(() => {})
  }

  private ensureWorker(installPath: string): Worker {
    if (this.worker?.installPath === installPath) {
      return this.worker.worker
    }
    this.stopWorker()

    const workerData: MapRendererWorkerData = { installPath }
    // Its own entry in the same build output as this module.
    const worker = new Worker(path.join(__dirname, 'map-renderer.js'), {
      workerData,
      name: 'map-renderer',
    })
    let fatalError: unknown
    worker
      .on('message', (response: RenderResponse) => this.onResponse(response))
      .on('error', err => {
        // `exit` fires after this and fails the render in progress.
        fatalError = err
      })
      .on('exit', () => {
        if (this.worker?.worker === worker) {
          this.worker = undefined
        }
        if (this.current?.worker === worker) {
          this.fail(
            new Error(
              'map renderer exited before responding' +
                (fatalError ? `: ${getErrorStack(fatalError) ?? String(fatalError)}` : ''),
            ),
          )
        }
      })
    this.worker = { worker, installPath }
    return worker
  }
}
