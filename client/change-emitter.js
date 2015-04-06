// A very simple EventEmitter replacement for classes that only emit one sort of event

class ChangeEmitter {
  constructor() {
    this._changeListeners = new Set()
  }

  register(cb) {
    this._changeListeners.add(cb)
  }

  unregister(cb) {
    return this._changeListeners.delete(cb)
  }

  notifyAll() {
    for (let listener of this._changeListeners) {
      listener()
    }
  }
}

module.exports = ChangeEmitter
