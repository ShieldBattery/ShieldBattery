export default class Queue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent
    this.processing = 0
    this.queue = []
  }

  addToQueue(func) {
    return new Promise((resolve, reject) => {
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
