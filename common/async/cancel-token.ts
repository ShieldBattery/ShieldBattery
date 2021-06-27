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

  protected cancelling = false

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

/**
 * An extension of `CancelToken` that allows you to treat multiple other tokens as a single one.
 * This is useful if you collect multiple tokens from callers and need a way to check on the status
 * of any of them.
 */
export class MultiCancelToken extends CancelToken {
  private tokens: CancelToken[]

  constructor(...tokens: CancelToken[]) {
    super()
    this.tokens = tokens
  }

  addToken(token: CancelToken) {
    this.tokens.push(token)
  }

  override get isCancelling() {
    if (this.cancelling) {
      return true
    } else {
      this.cancelling = this.tokens.some(t => t.isCancelling)
      return this.cancelling
    }
  }
}
