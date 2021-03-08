const CANCEL_ERROR = Symbol('CancelError')

export class CancelError extends Error {
  readonly [CANCEL_ERROR] = true

  constructor(msg = 'Operation cancelled') {
    super(msg)
  }

  static isCancelError(err: Error): err is CancelError {
    return !!(err as any)[CANCEL_ERROR]
  }
}

export default class CancelToken {
  static isCancelError(err: Error): err is CancelError {
    return !!(err as any)[CANCEL_ERROR]
  }

  private cancelling = false

  cancel() {
    this.cancelling = true
  }

  get isCancelling() {
    return this.cancelling
  }

  throwIfCancelling() {
    if (this.isCancelling) {
      throw new CancelError()
    }
  }
}
