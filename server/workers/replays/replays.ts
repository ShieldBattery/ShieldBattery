import { isMainThread, Worker } from 'node:worker_threads'
import { AsyncResult, Result } from 'typescript-result'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { FromWorkerMessage, ParsedReplay, ParseReplayRequest, ParseReplayResult } from './messages'

if (!isMainThread) {
  throw new Error('replays.ts should only be imported from the main thread')
}

let CONCURRENCY = Number(process.env.SB_REPLAY_WORKER_CONCURRENCY)
if (Number.isNaN(CONCURRENCY)) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SB_REPLAY_WORKER_CONCURRENCY must be a number')
  } else {
    CONCURRENCY = 1
  }
}

interface Work {
  path: string
  deferred: Deferred<ParseReplayResult>
}

const workers: Worker[] = []
// The workers that are ready to receive work (and not currently doing work)
const workersReady: Set<Worker> = new Set()
const workQueue: Work[] = []
const workInProgress: Map<Worker, Work> = new Map()

function processQueue() {
  if (workQueue.length === 0) {
    return
  }
  if (workersReady.size === 0) {
    return
  }

  const work = workQueue.shift()!
  const worker = workersReady.values().next().value!
  workersReady.delete(worker)
  workInProgress.set(worker, work)

  const request: ParseReplayRequest = { type: 'parse', path: work.path }
  worker.postMessage(request)
}

Promise.resolve()
  .then(async () => {
    const logger = (await import('../../lib/logging/logger')).default
    logger.info(`Starting replay workers with concurrency ${CONCURRENCY}`)

    function startWorker() {
      const worker = new Worker(require.resolve('../launch-worker'), {
        name: `replay-worker`,
        workerData: require.resolve('./replay-worker'),
      })
      logger.info(`Started replay worker ${worker.threadId}`)
      workers.push(worker)
      attachHandlers(worker)
    }

    function attachHandlers(worker: Worker) {
      worker
        .on('message', (msg: FromWorkerMessage) => {
          if (msg.type === 'ready') {
            logger.info(`replay worker ${worker.threadId} is ready`)
            workersReady.add(worker)
            processQueue()
          } else if (msg.type === 'parseComplete') {
            if (!workInProgress.has(worker)) {
              logger.error(
                `Received parsed message from worker ${worker.threadId} with no work in progress`,
              )
              return
            } else {
              const work = workInProgress.get(worker)!
              workInProgress.delete(worker)
              work.deferred.resolve(msg)
              workersReady.add(worker)
            }
            processQueue()
          } else {
            msg satisfies never
          }
        })
        .on('error', err => {
          logger.error({ err }, 'replay worker error')
          if (workInProgress.has(worker)) {
            const work = workInProgress.get(worker)!
            workInProgress.delete(worker)
            work.deferred.reject(
              new Error(`worker errored while processing replay ${work.path}`, { cause: err }),
            )
          }
          // NOTE(tec27): 'exit' will happen after this, so we don't need to restart it here
        })
        .on('exit', code => {
          if (workInProgress.has(worker)) {
            const work = workInProgress.get(worker)!
            workInProgress.delete(worker)
            work.deferred.reject(new Error(`worker exited while processing replay ${work.path}`))
          }

          logger.error(
            `Replay worker ${worker.threadId} stopped with exit code ${code}, restarting...`,
          )
          startWorker()
        })
    }

    for (let i = 0; i < CONCURRENCY; i++) {
      startWorker()
    }
  })
  .catch(swallowNonBuiltins)

export function parseReplay(path: string): AsyncResult<ParsedReplay, Error> {
  return Result.fromAsyncCatching(async () => {
    const deferred = createDeferred<ParseReplayResult>()
    workQueue.push({ path, deferred })
    processQueue()

    const result = await deferred
    if ('error' in result) {
      return Result.error(result.error)
    } else {
      return Result.ok(result.replay)
    }
  })
}
