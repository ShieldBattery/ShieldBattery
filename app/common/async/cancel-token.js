const errorName = Symbol('CancelError')

class CancelError extends Error {
  constructor(msg = 'Operation cancelled') {
    super(msg)
    this.name = errorName
  }
}

export default class CancelToken {
  static ERROR_NAME = errorName

  constructor() {
    this._cancelling = false
  }

  cancel() {
    this._cancelling = true
  }

  get isCancelling() {
    return this._cancelling
  }

  throwIfCancelling() {
    if (this.isCancelling) {
      throw new CancelError()
    }
  }
}
