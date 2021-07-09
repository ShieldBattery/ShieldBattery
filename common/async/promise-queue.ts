interface QueueEntry<T> {
  func: () => Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
}

export default class Queue<T> {
  private processing = 0
  private queue: Array<QueueEntry<T>> = []

  constructor(private maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent
    this.processing = 0
    this.queue = []
  }

  addToQueue(func: () => Promise<T>) {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        func,
        resolve,
        reject,
      })
      this._processQueue()
    })
  }

  _processQueue() {
    if (this.processing >= this.maxConcurrent) {
      return
    }

    const item = this.queue.shift()
    if (!item) {
      return
    }

    this.processing++

    item
      .func()
      .then(value => {
        this.processing--
        item.resolve(value)
        this._processQueue()
      })
      .catch(err => {
        this.processing--
        item.reject(err)
        this._processQueue()
      })
  }
}
