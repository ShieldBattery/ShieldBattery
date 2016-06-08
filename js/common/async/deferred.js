// Deferred are Promises that are meant to be resolved externally, through #resolve and #reject
// methods on the Deferred object. This is useful for cases where you want to pass a promise to
// something for waiting on, but its resolution doesn't directly map to another async function.
class Deferred extends Promise {
  constructor(executor) {
    super(executor)
    // These will be overwritten by the creator function
    this._resolve = null
    this._reject = null
  }


  resolve(value) {
    this._resolve(value)
  }

  reject(err) {
    this._reject(err)
  }
}

export default function createDeferred() {
  let _resolve, _reject
  const deferred = new Deferred((resolve, reject) => {
    // This executes *immediately* (before the stuff later on in the outer function)
    _resolve = resolve
    _reject = reject
  })

  deferred._resolve = _resolve
  deferred._reject = _reject
  return deferred
}
