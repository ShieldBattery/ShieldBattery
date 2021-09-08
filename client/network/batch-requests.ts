import { ReduxAction } from '../action-types'
import { DispatchFunction } from '../dispatch-registry'

/**
 * Generic request queue that batches requests to the next microtask. This is useful if you might
 * be displaying a UI that contains multiple entities of the same type that all may need data from
 * the server: this queue allows you to make a request from their individual UI components, but
 * combine those client-side requests into a single HTTP request.
 */
export class MicrotaskBatchRequester<IdType, ErrorType = unknown> {
  private inQueue = new Set<IdType>()
  private inProgress = new Set<IdType>()
  private processing = false

  /**
   * Creates a new BatchRequester to batch up requests for data.
   *
   * @param maxBatchSize the maximum number of items that should be included in a single request
   * @param makeRequest a function that should make a request for the `items` given, returning a
   *   promise that resolves when that request is completed
   * @param onError a function that will be called if an error occurs while making requests. Note
   *   that this will *not* be called if the Promise returned by `makeRequest` rejects. You should
   *   handle those errors yourself (e.g. by dispatching the Promise and inspecting the `error`
   *   field on the resulting action).
   */
  constructor(
    private maxBatchSize: number,
    private makeRequest: (
      dispatch: DispatchFunction<ReduxAction>,
      items: ReadonlyArray<IdType>,
    ) => Promise<unknown>,
    private onError: (err: ErrorType) => void,
  ) {}

  /**
   * Queues a request for the item with the specified `id`. Requests will be batched and processed
   * on the next microtask.
   *
   * If the item already has a request in flight, this request will be discarded.
   */
  request(dispatch: DispatchFunction<ReduxAction>, id: IdType) {
    if (this.inProgress.has(id)) {
      return
    }

    this.inQueue.add(id)
    if (!this.processing) {
      this.processing = true
      Promise.resolve()
        .then(() => this.processQueue(dispatch))
        .catch(err => this.onError(err))
    }
  }

  private async processQueue(dispatch: DispatchFunction<ReduxAction>): Promise<void> {
    try {
      while (this.inQueue.size > 0) {
        this.inProgress = this.inQueue
        this.inQueue = new Set()

        const promises = []
        let items = Array.from(this.inProgress)
        do {
          const toRequest = items.slice(0, this.maxBatchSize)
          items = items.slice(this.maxBatchSize)

          promises.push(this.makeRequest(dispatch, toRequest))
        } while (items.length)

        await Promise.allSettled(promises)
      }
    } finally {
      this.inProgress.clear()
      this.processing = false
    }
  }
}
