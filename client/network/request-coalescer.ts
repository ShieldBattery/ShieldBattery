import { BatchedAbortSignals } from '../../common/async/abort-signals'

/**
 * A helper class which allows you to use `BatchedAbortSignals` more easily. See the description
 * of that class for more info.
 */
export class RequestCoalescer<T> {
  private requestsInProgress = new Map<T, BatchedAbortSignals>()

  async makeRequest(
    id: T,
    signal: AbortSignal | undefined,
    requestFn: (batchedSignal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    let batchedSignals = this.requestsInProgress.get(id)
    if (batchedSignals && !batchedSignals.aborted) {
      batchedSignals.add(signal)
      return
    }

    batchedSignals = new BatchedAbortSignals(signal)
    this.requestsInProgress.set(id, batchedSignals)

    try {
      await requestFn(batchedSignals.signal)
    } finally {
      if (this.requestsInProgress.get(id) === batchedSignals) {
        this.requestsInProgress.delete(id)
      }
    }
  }
}
